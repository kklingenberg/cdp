# Example: Prometheus post processing

This example illustrates the use of the `poll` input form and the raw
`wrap` option, which together can be combined to turn CDP into a
[Prometheus](https://prometheus.io/) post-processor.

The example runs on its own. To start it, use:

```bash
docker compose up -d
```

And then watch logs with:

```bash
docker compose logs -f cdp
```

This example's results are sent to a Prometheus Pushgateway
instance. You may also check any instant's values by reading
Pushgateway's exported metrics at <http://localhost:9091/metrics>. Of
course, those same metrics are in turn scraped by the Prometheus
instance, so you might as well navigate metrics using the promemetheus
GUI at <http://localhost:9090>. Look for metrics with the
`postprocessed_` prefix.

To stop the example and cleanup, use the `-v` option of docker
compose down:

```bash
# Cleanup prometheus volume
docker compose down -v
```

## What does it do?

The example shows a pipeline that takes input from active requests
sent to a Prometheus federation endpoint, and processes the response
in a pipeline of parsing, altering, and forwarding. It can be used as
a starting point for using CDP to manipulate Prometheus data.

Since the input is UTF-8 plain text, the `wrap.raw` option is set to
`true`. Events captured this way wrap lines of text in the input.

The parsing step uses `jq` to extract information from each line.

Finally, a `send-http` step together with a `jq` filter can be used to
send events in OpenMetrics format forward to a Pushgateway instance.

From these components and the rest of the pipeline you should observe
three things:
1. [The `poll` input form](/../../#poll).
1. [The `wrap.raw` wrapping option](/../../#wrapping), used to
   tollerate the output of Prometheus' federation endpoint.
1. Various uses of [`jq` filters](/../../#jq-expressions) to
   manipulate data.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "Prometheus metrics post-processing"

input:
  poll:
    target: http://prometheus:9090/federate?match[]=prometheus_http_requests_total
    seconds: 5
    wrap:
      name: _
      raw: true

steps:

  # This step reads metric lines and parses them into events. The
  # metric name is stored as the event's name, while the metric labels
  # and value are stored in the event's payload. The payload structure
  # is:
  # - **v**: number, the metric value.
  # - **l**: object or null, the labels collected.
  # The metric type is notably not included anywhere, to keep this
  # example short.
  parse:
    flatmap:
      send-receive-jq: |-
        .[0].t as $trace
        | .[].d
        | if startswith("#") or . == "" then empty else . end
        | split(" ")
        | .[1] as $value
        | .[0]
        | capture("(?<n>[^{]+)({(?<labels>.+)})?")
        | {
          n: .n,
          d: {
            v: ($value | tonumber),
            l: (if (.labels == null) then null else (
              .labels
              | split(",")
              | map(ltrimstr(" "))
              | map(rtrimstr(" "))
              | map(split("="))
              | map({key: .[0], value: .[1][1:-1]})
              | map(select(.key != "job" and .key != "instance"))
              | from_entries
            ) end)
          },
          t: $trace
        }

  # Debug the parsed metrics.
  print:
    after:
      - parse
    flatmap:
      send-stdout:

  # This is a toy example that simply squares each metric.
  square:
    after:
      - parse
    flatmap:
      send-receive-jq: |-
        .[] | . * {d: (.d * {v: (.d.v * .d.v)})}

  # Send to pushgateway.
  push:
    after:
      - square
    window:
      events: 1000
      seconds: 4
    reduce:
      send-http:
        target: http://pushgateway:9091/metrics/job/cdp_postprocessor/instance/cdp
        headers:
          Content-Type: text/plain; version=0.0.4
        jq-expr: |
          def formatlabels:
            if .d.l == null
            then ""
            else "{" + (
              .d.l
              | to_entries
              | map(.key + "=" + (.value | tojson))
              | join(",")
            ) + "}"
            end;

          "# TYPE postprocessed_" + .[0].n + " gauge\n" +
          (map("postprocessed_" + .n + formatlabels + " " + (.d.v | tostring)) | join("\n")) +
          "\n"

```
