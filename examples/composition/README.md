# Example: Composition

This example illustrates the use of various input forms and step
functions to interconnect several CDP programs. The example doesn't
achieve anything practical, but serves as a reference for the means of
composition available.

The example is interactive. To run it, use:

```bash
docker compose up
```

And from another terminal send events using `curl` to the configured
endpoint of the 'initial' CDP program: <http://localhost:8000/events>:

```bash
curl --data-binary "@test-events.ndjson" "http://localhost:8000/events"
```

Logs of interest will be visible on the first terminal, and they will
refer to four instances of CDP: `first`, `second`, `third` and
`fourth` (the name of the respective services in
`docker-compose.yml`).

To clean up, cancel the process in the first terminal with Ctrl-C and
then bring the stack down including volumes:

```bash
docker compose down -v
```

## What does it do?

The example shows four pipelines that take input from an [HTTP
input](/../../#http), [`tail` input](/../../#tail) and [`poll`
input](/../../#poll) and execute some forwarding steps with the
[`send-http`](/../../#send-http), [`send-file`](/../../#send-file) and
[`expose-http`](/../../#expose-http) functions. Also, events are
logged in each step showing the pipelines they've been in.

## Pipeline files

The pipeline files are named after the docker compose services:

- [`pipeline-first.yaml`](pipeline-first.yaml) is the pipeline
  that receives initial events via HTTP and forwards them to the
  `second` one via a file.
- [`pipline-second.yaml`](pipeline-second.yaml) is the pipeline that
  receives events from the `first` one via a file and forwards them
  to the `third` one via HTTP.
- [`pipeline-third.yaml`](pipeline-third.yaml) is the pipeline that
  receives events from the `second` one via HTTP and forwards them to
  the `fourth` one via HTTP exposition.
- [`pipeline-fourth.yaml`](pipeline-fourth.yaml) is the pipeline that
  fetches events from the `third` pipeline via HTTP polling.
