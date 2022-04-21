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
input](/../../#http) and executes a single trivial pipeline step that
prints them.

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
