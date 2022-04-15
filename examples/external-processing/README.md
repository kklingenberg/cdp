# Example: External processing

This example illustrates the use of external processing services which
receive events via HTTP and respond with transformed events.

The example is interactive. To run it, use:

```bash
docker compose run --rm cdp
```

And type in numbers into standard input, using one line for each
number. Use `Ctrl-D` to end the stream.

## What does it do?

This example consists of a pipeline with input captured from stdin
using the `wrap` option, and five steps that illustrate a plausible
structure that funnels data to external calculation services.

Two services are provided in the docker-compose stack: a _rooter_
service which calculates square roots, and a _siner_ service which
calculates the trigonometric sine function. The implementation is
common to both and can be seen in [`main.py`](main.py), although the
specifics are not meant to be used as reference.

The pipeline illustrates six key points:
1. [DAG edges](/../../#step-dependencies), declared using the `after`
   keyword.
1. The use of the [`wrap`](/../../#wrapping) option for input and pipeline
   steps.
1. The use of `keep-when` for sanitizing events.
1. The use external services with `send-receive-http`.
1. The use of [windowing](/../../#vector-definitions) to control the rate
   of requests to external services.
1. An approach to merging using a simple `jq` post-processing step.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "External processing"
input:
  stdin:
    wrap: _

steps:

  numbers:
    flatmap:
      keep-when:
        type: number

  set to x:
    after:
      - numbers
    flatmap:
      send-receive-jq: ".[] | . * {d: {x: .d}}"

  square root:
    after:
      - set to x
    window:
      events: 1000
      seconds: 0.5
    reduce:
      send-receive-http:
        target: http://rooter/calculate
        jq-expr: map(.d) # This disables ndjson for the request, as
                         # the vector is sent as a single JSON-encoded
                         # array of values keyed to x.
        headers:
          Content-Type: application/json
        wrap: square-root

  sine:
    after:
      - set to x
    window:
      events: 1000
      seconds: 0.5
    reduce:
      send-receive-http:
        target: http://siner/calculate
        jq-expr: map(.d)
        headers:
          Content-Type: application/json
        wrap: sine

  merge:
    after:
      - square root
      - sine
    window:
      events: 2000
      seconds: 3
    flatmap:
      send-stdout:
        jq-expr: |-
          .[0].n as $kind
          | .[0].d.x as $x
          | map(select((.d.x == $x) and (.n != $kind))) as $other
          | if ($other | length) == 0 then empty else .[0].d * $other[0].d end

```
