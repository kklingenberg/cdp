# Example: Exposition

This example illustrates the use of the `expose-http` step function,
which together with `jsonnet` code can turn a CDP program into a
[Prometheus](https://prometheus.io/) scrape target.

The example runs on its own. To start it, use:

```bash
docker compose up -d
```

And then access the Prometheus GUI at <http://localhost:9090>. There
you can look for events named `exposition_example`. Their values are
random in the interval [0, 1].

To stop the example and cleanup, use the `-v` option of docker
compose down:

```bash
# Cleanup prometheus volume
docker compose down -v
```

## What does it do?

The example shows a pipeline that uses the `generator` input form to
produce a steady stream of made-up events. It then exposes those
events via HTTP using the `expose-http` step function and a `jsonnet`
function. The exposed responses are compatible with the OpenMetrics
format.

A Prometheus instance is also configured to scrape those formatted
events.

From these things you should observe two things:
1. [The `generator` input form](/../../#generator).
1. [The `expose-http` step function](/../../#expose-http), used in
   tandem with a `jsonnet` function to convert events to an
   appropriate format.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "Event exposition"

input:
  generator: exposition_example

jsonnet-prelude: |-
  local eventPipeline(event) =
    event.t[std.length(event.t) - 1].p;

  local eventSignature(event) =
    event.t[std.length(event.t) - 1].h;

steps:
  expose for prometheus:
    flatmap:
      expose-http:
        endpoint: /metrics
        port: 8002
        responses: 100
        headers:
          Content-Type: text/plain; version=0.0.4
        jsonnet-expr: |-
          function(events)
            "# TYPE " + events[0].n + " gauge\n" +
            std.join(
              "\n",
              std.map(
                function(event)
                  event.n +
                  "{pipeline=\"" + eventPipeline(event) + "\"," +
                  "signature=\"" + eventSignature(event) + "\"} " +
                  std.toString(event.d),
                events
              )
            ) +
            "\n"

```
