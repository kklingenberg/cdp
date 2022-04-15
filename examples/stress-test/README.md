# Example: Stress test

This example shows a setup for stress-testing a CDP program. It's
comprised of three components:

1. The CDP program itself.
2. An input generator, which is parametrized to control the load to
   use in each test. This is a simple sh script.
3. A monitoring system, to measure performance during the test. This
   is using [cAdvisor](https://github.com/google/cadvisor) to measure
   what happens inside the CDP container.

The goal of a stress test is to understand how an application performs
under heavy load, and can help in learning the maximum real throughput
capacity of a pipeline. This knowledge can help in planning for
replication strategies and resource allocations. CDP programs are not
necessarily able to be replicated without loss of processing
repeatability (that depends on the nature of the processing being
done), so each case is to be studied individually. Even so, setting up
some sort of stress test early can help you with being aware of your
program's limits, at the very least.

## Run it

To run this test, two parameters need to be set: **rate**, and **chunk
size**. Rate is how often a chunk of data is sent to the CDP pipeline,
measured in Hertz. There's a limit to the rate you can specify, set by
the input generator; the script uses
[usleep](https://git.busybox.net/busybox/tree/coreutils/usleep.c),
which can only take an integer number of microseconds, which makes the
theoretical limit 1 MHz or 1000000. In practice the limit will be much
lower, since it's also bounded by concurrency limits of the machine
it's being run on.

To run the test, execute the following sequence:

```bash
# Start the CDP program and cAdvisor for monitoring.
docker compose up -d
# Start the input generator.
# 10 is rate in Hz, and 100 is chunk size in quantity of events. Adjust those values as you will.
docker compose run --rm input 10 100
# That should crash the pipeline eventually.
# Ctrl-C to stop the input.
```

Then go to <http://localhost:8080/docker/stress-test-cdp-1> to see
metrics about the CDP container.

Optionally check the logs of the CDP program with:

```bash
docker compose logs -f cdp
```

## Get insights

One common strategy to get a concrete result is to increase the
**rate** parameter until the CDP program fails. It will probably fail
in one or two ways:
- The input-generator will report the inability to send input chunks.
- The CDP program will crash, which will also cause the above.

Another way is to vary both **rate** and **chunk size** parameters and
record the results from cAdvisor periodically for later
processing. This could be useful if you want to find resource limits
and breakpoints for replication. For example, using the [cAdvisor
API](https://github.com/google/cadvisor/blob/master/docs/api.md):

```bash
# This script requires curl and jq. Get jq from https://stedolan.github.io/jq/.
# Ctrl-C twice to exit
cdp_container=$(curl -sS http://localhost:8080/api/v1.3/docker/stress-test-cdp-1 | jq -r 'keys | .[0]')
while :
do
    curl -sS "http://localhost:8080/api/v1.3/containers${cdp_container}" \
        | jq -c .stats[] >> "stats.ndjson"
    sleep 60
done
```

Then plot and/or analyse the data points in `stats.ndjson`.

Yet another aspect to consider is that it's very likely that the
real-world usage of the CDP pipeline doesn't involve a constant input
rate. It might be acceptable for your pipeline to have lower
throughput than the input for short periods, as long as the queues
hold. The queues are held in memory, so yet another aspect to
fine-tune is maximum heap size of the nodejs process. This can be done
adjusting the [`--max-old-space-size`
option](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes),
as it's done in this example's `docker-compose.yml` file (where it's
intentionally set to a low value to accelerate the crash).

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
# This pipeline is utterly useless, and was only built as an example
# for stress-testing. It features several windows (queues) and several
# parallel processing (using jq). Nothing interesting should be
# expected from the processing logic itself, however.

name: "Checking divisivility and applying primality heuristics"

input:
  http: /events

steps:
  numbers:
    flatmap:
      keep-when:
        type: number

  multiples of two:
    after:
      - numbers
    match/drop: "not.#"
    window:
      events: 100
      seconds: 10
    reduce:
      send-receive-jq:
        jq-expr: ".[].d | if fmod(.; 2) == 0 then empty else . end"
        wrap: "not.multiples.of.two"

  multiples of five:
    after:
      - multiples of two
    window:
      events: 100
      seconds: 10
    reduce:
      send-receive-jq:
        jq-expr: ".[].d | if fmod(.; 5) == 0 then empty else . end"
        wrap: "not.multiples.of.five"

  multiples of seven:
    after:
      - multiples of five
    window:
      events: 100
      seconds: 10
    reduce:
      send-receive-jq:
        jq-expr: ".[].d | if fmod(.; 7) == 0 then empty else . end"
        wrap: "not.multiples.of.seven"

  fermat using a=31:
    after:
      - multiples of seven
    window:
      events: 100
      seconds: 10
    reduce:
      send-receive-jq:
        jq-expr: |-
          def mulmod($a; $b; $m): [$a, $b, 0] | until(
            .[0] == 0;
            [
              (.[0] / 2 | floor),
              fmod(.[1] + .[1]; $m),
              if fmod(.[0]; 2) == 1 then fmod(.[2] + .[1]; $m) else .[2] end
            ]
          ) | .[2];

          def expmod($a; $b; $m): [$b, $a, 1] | until(
            .[0] == 0;
            [
              (.[0] / 2 | floor),
              mulmod(.[1]; .[1]; $m),
              if fmod(.[0]; 2) == 1 then mulmod(.[2]; .[1]; $m) else .[2] end
            ]
          ) | .[2];

          map(
            .d as $n
            | expmod(31; $n - 1; $n)
            | if . == 1 then $n else empty end
          ) | .[]
        wrap: "candidate.fermat.31"

  fermat using a=73:
    after:
      - multiples of seven
    window:
      events: 100
      seconds: 10
    reduce:
      send-receive-jq:
        jq-expr: |-
          def mulmod($a; $b; $m): [$a, $b, 0] | until(
            .[0] == 0;
            [
              (.[0] / 2 | floor),
              fmod(.[1] + .[1]; $m),
              if fmod(.[0]; 2) == 1 then fmod(.[2] + .[1]; $m) else .[2] end
            ]
          ) | .[2];

          def expmod($a; $b; $m): [$b, $a, 1] | until(
            .[0] == 0;
            [
              (.[0] / 2 | floor),
              mulmod(.[1]; .[1]; $m),
              if fmod(.[0]; 2) == 1 then mulmod(.[2]; .[1]; $m) else .[2] end
            ]
          ) | .[2];

          map(
            .d as $n
            | expmod(31; $n - 1; $n)
            | if . == 1 then $n else empty end
          ) | .[]
        wrap: "candidate.fermat.73"

  log candidates:
    after:
      - fermat using a=31
      - fermat using a=73
    flatmap:
      send-stdout:
        jq-expr: |-
          .[] | "The number \(.d) is a prime candidate from \(.n)"

```
