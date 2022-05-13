# Example: Persistence with Hasura

This example illustrates two things: a simple
[Hasura](https://hasura.io/) setup that can be used to provide a
persistence backend for CDP programs, and the use of persistence to
achieve complex step preconditions, which is a feature not directly
provided by CDP.

The example runs on its own. To start it, execute:

```bash
docker compose up -d
```

Then navigate to
<http://localhost:8080/console/data/cdp/schema/public/tables/event/browse?sort=id%3Bdesc>
to see the events getting saved to the PostgreSQL database.

To stop the example, bring down the stack and remember to destroy
unwanted volumes:

```bash
docker compose down -v
```

## What does it do?

The example has two points of interest: the CDP program which
illustrates interaction with a GraphQL API, and the Hasura setup.

The CDP program starts with a fake data generator, which simulates two
event streams: one with events occurring frequently, and the other
with events occurring rarely. While real-life data streams are
probably much less predictable (if at all), this setup is enough to
expose a problem with CDP's core: it can't block streams while waiting
for specific events to appear.

To solve the issue this example uses an external persistence service:
Hasura (and PostgreSQL). It first saves everything the pipeline
receives using Hasura's API, and then pulls values from Hasura to
perform the computation.

The pipeline illustrates three key points:
1. [The generator input form](/../../#generator) which is used to test
   the rest of the pipeline.
1. [`jq` filters](/../../#about-jq-expressions) used to assemble
   [GraphQL](https://graphql.org/) requests.
1. [The `concurrent` option of `send-http`](/../../#send-http) used
   here to prevent paralellism and provide synchronicity between
   pipeline steps.

Aside from the pipeline, this example also shows _one way_ of
configuring Hasura for CDP event storage. Relevant references can be
found on the [`docker-compose.yml`](docker-compose.yml) file and the
[`hasura`](hasura) folder. The PostgreSQL DDL for the example can be
found on the [migration
file](hasura/migrations/cdp/1652369701237_initial/up.sql).

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
# This pipeline fakes two time series: 'x' and 'y', where the first
# one has frequent events and the second one doesn't. This setup is
# used to illustrate the use of external persistence (through Hasura
# in this example) to implement a step that can pull past events for
# its computation.

name: "Persistence with Hasura"

input:
  generator:
    seconds: 0.1

steps:
  # For readers: don't dwell on the first two steps too much. Mentally
  # replace them with two real data streams of different rates.
  make x with high probability:
    flatmap:
      send-receive-jq:
        jq-expr: |-
          .[] | if .d < 0.95 then .d else empty end
        wrap:
          name: "x"

  make y with low probability:
    flatmap:
      send-receive-jq:
        jq-expr: |-
          .[] | if .d >= 0.95 then .d else empty end
        wrap:
          name: "y"

  # Persist the input so that the proper pairs can be assembled
  # afterwards, independent of the event vectors formed by CDP.
  persist input:
    after:
      - make x with high probability
      - make y with low probability
    window:
      events: 100
      seconds: 3
    reduce:
      send-http:
        target: http://graphql-engine:8080/v1/graphql
        headers:
          Content-Type: application/json
        jq-expr: &persist-events |-
          {
            query: (
              "mutation persistEvents($events: [event_insert_input!]!)" +
              "{ insert_event(objects: $events) { returning { id } } }"
            ),
            variables: {events: map({
              name: .n,
              data: .d,
              timestamp: (.t[-1].i | todate),
              traces: {data: (.t | map({
                pipeline: .p,
                signature: .h,
                timestamp: (.i | todate)
              }))}
            })},
            operationName: "persistEvents"
          }
        # ensure that all persistence calls are executed before
        # continuing with the next step
        concurrent: 1

  # Build a pair of the given value with the latest complementary
  # value from database. This step is not directly achievable through
  # just CDP. This is where external persistence is required, and
  # Hasura helps us out.
  assemble pair:
    after:
      - persist input
    window:
      events: 100
      seconds: 1
    reduce:
      send-receive-http:
        target: http://graphql-engine:8080/v1/graphql
        headers:
          Content-Type: application/json
        jq-expr: |-
          {
            query: (
              "query getComplementary($x: String!, $y: String!, $upTo: timestamptz!) { " +
              "x: event(where: {timestamp: {_lte: $upTo}, name: {_eq: $x}}, " +
              "order_by: {timestamp: desc}, limit: 1) { id name data timestamp } \n" +
              "y: event(where: {timestamp: {_lte: $upTo}, name: {_eq: $y}}, " +
              "order_by: {timestamp: desc}, limit: 1) { id name data timestamp } }"
            ),
            variables: {
              x: "x",
              y: "y",
              upTo: (.[-1].t[-1].i | todate)
            },
            operationName: "getComplementary"
          }
        wrap: persisted-x-y-pair

  # Add the pair of values. This is the unimaginative example of a
  # "complex computation".
  add values:
    after:
      - assemble pair
    flatmap:
      send-receive-jq: |-
        .[] | if (.d.data.x | length) > 0 and (.d.data.y | length) > 0 then {
          n: "x-plus-y",
          d: (.d.data.x[0].data + .d.data.y[0].data)
        } else empty end

  # Persist the result of our "complex computation".
  persist result:
    after:
      - add values
    window:
      events: 100
      seconds: 3
    reduce:
      send-http:
        target: http://graphql-engine:8080/v1/graphql
        headers:
          Content-Type: application/json
        jq-expr: *persist-events

```
