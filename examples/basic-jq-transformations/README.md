# Example: Basic `jq` transformations

This example illustrates the use of
[jq](https://stedolan.github.io/jq/) inside a pipeline definition for
basic tasks.

The example is interactive. To run it, use:

```bash
docker compose run --rm cdp
```

And type in various events into standard input. Optionally, you may
use the given test event file to try a few:

```bash
docker compose run --rm -T cdp < test-events.ndjson
```

## What does it do?

The example shows a pipeline that takes input from stdin and executes
three pipeline steps, two of them using `jq` to transform events.

Input can be typed into the terminal and must consist of JSON-encoded
valid events (according to [the shape of
events](/../../#what-cdp-understands-by-data)).

The first step takes the input of the pipeline and creates a duplicate
event if the received event contains data (i.e. the `d` field). The
original event's name is changed to have a `".given"` suffix, and its
data field is forced to exist or be `null`. The potentially new event
is also named from the original, with a `".healthy"` suffix.

The second and third steps print events to stdout. The second step
only prints events that were suffixed with `".healthy"` by the first
one, and prints them fully (as JSON). The third step prints only event
names generated by the first step, so it will print names ending in
`".given"` and `".healthy"`.

From these components and the rest of the pipeline you should observe
four things:
1. [The `stdin` input form](/../../#stdin).
1. [`jq`-based processing](/../../#about-jq-expressions) being used to
   transform events and before forwarding them (to stdout).
1. [DAG edges](/../../#step-dependencies), declared using the `after`
   keyword.
1. A simple case of [matching](/../../#pattern-matching), using
   `match/drop` and a string pattern.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "Basic jq transformations"
input:
  stdin:
steps:
  # Two types of steps are illustrated: jq transformations and stdout
  # forwarding (with and without jq).

  duplicate-and-wrap:
    flatmap:
      send-receive-jq: |-
        map([. * {
          n: (.n + ".given"),
          d: .d
        }] + (if .d == null then [] else [. * {
          n: (.n + ".healthy"),
          d: .d
        }] end))

  show-only-healthy:
    after:
      - duplicate-and-wrap
    match/drop: "#.healthy"
    flatmap:
      send-stdout:

  show-all-names:
    after:
      - duplicate-and-wrap
    flatmap:
      send-stdout:
        jq-expr: ".[].n"

```
