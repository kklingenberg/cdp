package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/google/go-jsonnet"
	"io"
	"os"
)

// This program receives a snippet of Jsonnet code and applies it
// continuously to all stdin lines, feeding each line as a top-level
// argument. The output is compacted and written to stdout, in one
// line for evaluation result. Errors found during Jsonnet execution
// produce no output.
func main() {
	if len(os.Args) > 4 || len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: stream-jsonnet [tag [input]] <code>")
		os.Exit(1)
	}
	jsonnetProgram := os.Args[len(os.Args)-1]
	tag := "stream.jsonnet"
	if len(os.Args) > 2 {
		tag = os.Args[1]
	}
	input := "input"
	if len(os.Args) > 3 {
		tag = os.Args[2]
	}

	// Check the syntactic correctness of the jsonnet program.
	ast, err := jsonnet.SnippetToAST(tag, jsonnetProgram)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}

	// Process each line as input.
	jsonnetVM := jsonnet.MakeVM()
	reader := bufio.NewReader(os.Stdin)
	for {
		switch line, err := reader.ReadString('\n'); err {
		case nil:
			jsonnetVM.TLACode(input, line)
			output, err := jsonnetVM.Evaluate(ast)
			if err != nil {
				// Since the Jsonnet program was deemed syntactically
				// correct, an error here is assumed to be an error in
				// the input or the execution. Skipping this input is
				// thus compatible with the `try` expression applied
				// to jq filters.
			} else {
				var compacted bytes.Buffer
				json.Compact(&compacted, []byte(output))
				compacted.Write([]byte("\n"))
				compacted.WriteTo(os.Stdout)
			}

		case io.EOF:
			os.Exit(0)

		default:
			fmt.Fprintln(os.Stderr, "error:", err)
			os.Exit(1)
		}
	}
}
