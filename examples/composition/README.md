# Example: Composition

This example illustrates the use of various input forms and step
functions to interconnect several CDP programs. The example doesn't
achieve anything practical, but serves as a reference for the means of
composition available.

The example is interactive. To run it, use:

```bash
docker compose up -d redis emqx rabbitmq
sleep 5 # or wait a while for services to be ready
docker compose up
```

And from another terminal send events using `curl` to the configured
endpoint of the 'initial' CDP program: <http://localhost:8000/events>:

```bash
curl --data-binary "@test-events.ndjson" "http://localhost:8000/events"
```

Logs of interest will be visible on the first terminal, and they will
refer to four instances of CDP: `first`, `second`, `third`, `fourth`,
`fifth`, `sixth` and `seventh` (the name of the respective services in
`docker-compose.yml`).

To clean up, cancel the process in the first terminal with Ctrl-C and
then bring the stack down including volumes:

```bash
docker compose down -v
```

## What does it do?

The example shows four pipelines that take input from an [HTTP
input](/../../#http), [`tail` input](/../../#tail), [`poll`
input](/../../#poll), [`redis` input](/../../#redis), [`amqp`
input](/../../#amqp) and [`mqtt` input](/../../#mqtt) and execute some
forwarding steps with the [`send-http`](/../../#send-http),
[`send-file`](/../../#send-file),
[`expose-http`](/../../#expose-http),
[`send-redis`](/../../#send-redis), [`send-amqp`](/../../#send-amqp)
and [`send-mqtt`](/../../#send-mqtt) functions. Also, events are
logged in each step showing the pipelines they've been in.

Worth noting is that the `second` and `fourth` services (and pipeline
files) use _environment variable interpolation_, which is enabled
using the `-e` flag. Check the
[docker-compose.yml](docker-compose.yml) file to note the usage of
this flag.

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
  fetches events from the `third` pipeline via HTTP polling and
  forwards them to the `fifth` one via the redis PUBLISH command.
- [`pipeline-fifth.yaml`](pipeline-fifth.yaml) is the pipeline that
  receives events from a redis PSUBSCRIBE subscription and forwards
  them to the `sixth` one via AMQP publishing.
- [`pipline-sixth.yaml`](pipeline-sixth.yaml) is the pipeline that
  receives events from an AMQP subscription and forwards them to the
  `seventh` one via MQTT publishing.
- [`pipeline-seventh.yaml`](pipeline-seventh.yaml) is the pipeline
  that receives events from a MQTT subscription.
