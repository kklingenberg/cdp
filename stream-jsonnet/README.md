# `stream-jsonnet`

This utility is a simple [Jsonnet](https://jsonnet.org/) wrapper that
presents it as a CLI that acts similarly to
[jq](https://stedolan.github.io/jq/): as a stdin processor.

To run CDP tests you'll need to have this program built, which can be
achieved easily with:

```bash
go build
```

## Usage

```bash
Usage: stream-jsonnet [tag [input]] <code>
```

- `tag` is a dummy file name, used by the Jsonnet VM for import
  resolution and error messages. By default it has value
  `"stream.jsonnet"`.
- `input` is the name of the input as fed to the Jsonnet VM via
  [top-level
  arguments](https://jsonnet.org/learning/tutorial.html#parameterize-entire-config). By
  default it has value `"input"`.
- `code` is the Jsonnet code, given inline.

For example:

```bash
echo '"world"' | ./stream-jsonnet 'function(input) {hello: input}'
# This prints {"hello":"world"}
```
