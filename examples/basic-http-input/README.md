# Example: Basic HTTP input

This example illustrates the use of the `http` input form.

The example is interactive. To run it, use:

```bash
docker compose up
```

And from another terminal send events using `curl` to the configured
endpoint: <http://localhost:8000/events>:

```bash
curl --data-binary "@test-events.ndjson" "http://localhost:8000/events"
```

Logs of interest will be visible on the first terminal.

## What does it do?

The example shows a pipeline that takes input from an [HTTP
input](/../../#input-forms) and executes a single trivial pipeline step
that prints them.

The HTTP input form allows for metrics exposition, which can be
checked by accessing <http://localhost:8000/metrics>. Metrics are
exposed in the [open metrics
format](https://github.com/OpenObservability/OpenMetrics), so they
should be able to be scraped by a prometheus instance without issue.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "Basic HTTP input"
input:
  http:
    endpoint: /events
    port: 8000
steps:
  print:
    flatmap:
      send-stdout:

```
