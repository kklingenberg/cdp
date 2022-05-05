# (C)omposable (D)ata (P)ipelines

This project attempts to achieve a building block for complex data
processing pipelines in the form of a pipeline _executor_, which can
then bind inputs and outputs with other executors via stdin/stdout or
HTTP. Data processing tasks can be written inline or be delegated to
external services.

## Overview

CDPs are programs that take data _events_ from a source, maybe
transform them, and maybe send them to specific targets. Two
definitions are required to make this concrete:

### What CDP understands by "Data"

All handled data in CDP comes in the form of _events_. Events are
objects with a fixed enveloping structure and a free inner
structure. They're always JSON-encodable and decodable. The envelope
is comprised of the following fields:

- **`n`**, which holds the event's _name_. The meaning assigned to the
  name of an event is for the user to decide, although it's useful to
  link it to the notion of _stream_ or _time series_, where it could
  identify a set of events. Names are mandatory to provide and are
  [restricted to a specific scheme](src/pattern.ts).
- **`d`**, which holds the event's contents. The contents may be any
  value, or they could even be missing.
- **`t`**, which holds the event's _trace_. This is optional to provide
  as the input, but CDP programs will always create or extend this
  field on each event they process. The value assigned to **t** will
  be a list of processing history, with each new entry added to the
  end of the list.
- **`t[].i`**, which holds a trace entry's timestamp, which corresponds
  to the unix timestamp (in seconds) at which a CDP program first
  received the event.
- **`t[].p`**, which holds a trace entry's pipeline name, which
  corresponds to the declared name of the CDP program which handled
  the event.
- **`t[].h`**, which holds a SHA-1 signature of the CDP program that
  received the event.

An example of a JSON-encoded event is the following:

```json
{
  "n": "madhava",
  "d": {"value": 3.1426047456630846, "terms": 5, "sqrt12": 3.4641016151377544},
  "t": [
    {"i": 1640465107, "p": "Madhava series", "h": "03a98d0890dcd7ba2ab25928e81fb94e6a778166"},
    {"i": 1640465318, "p": "PI approximations", "h": "df0673ccd8e0e7fba18c71648b37d4c1570e93f8"}
  ]
}
```

### What CDP understands by "Pipeline"

A CDP program or pipeline is a program built using a definition file
and a fixed structure. Pipelines are programs that take events from a
source and process them using user-defined steps. They're structured
as follows:

1. They have a **name**, which could be human-friendly or not as CDP
   only uses this for generating hashes.
1. They have an **input**, which defines the source of the event
   stream. Examples of inputs are STDIN or HTTP RESTy endpoints.
1. They have zero or more processing steps.

Each processing step in the pipeline is a function of a vector of
events, which in turn returns another (possibly modified) vector of
events for the other steps of the pipeline to process. To define a
step, the user may define five components:

1. The _step dependency_ (with the `after` keyword), which forces a
   step to feed on events from the specified steps it depends on. By
   default, all steps run in parallel unless the step dependency is
   specified, so this is the main way of specifying sequential
   processes. CDP will prevent the user from specifying a graph cycle
   through this mechanism.
1. The _pattern_ to match event names (with the `match/drop` and
   `match/pass` keywords). The pattern allows the user to limit even
   more which events are to be handled by this step. This can be
   combined with step dependency for more control over the pipeline
   graph's edges.
1. The _mode_ of stream processing, one of two alternatives: (a)
   **`flatmap`**, which are applied to all events incoming from
   previous steps, or (b) **`reduce`**, which are applied only once
   per event vector.
1. The _vector definition_ (with the `window` keyword) that indicates
   how CDP is to assemble each event vector for the processing
   step. This can be omitted to indicate that each vector should
   contain a single event.
1. And finally the _processing function_ itself (keyed by either
   `flatmap` or `reduce`), which will take an event vector and
   generate another event vector. It's here that a CDP user can choose
   to filter events out of the pipeline, enforce event structure,
   compute results inline, forward events to another program for
   external processing, or any combination of those.

CDP programs are written as YAML-formatted files. An example of a
trivial CDP program is the following:

```yaml
---
name: "pipe"
input:
  stdin:
steps:
  print:
    flatmap:
      send-stdout:

```

Less trivial examples can be found in the [examples
directory](examples).

## Usage

```bash
docker run --rm plotter/cdp:latest --help
```

Once you've created a pipeline file (say: `pipeline.yaml`), the
easiest way to run CDP is with Docker, Podman, or any OCI-compatible
software:

```bash
docker run \
    --rm \
    -v $(pwd)/pipeline.yaml:/app/pipeline.yaml \
    plotter/cdp:latest /app/pipeline.yaml
```

Alternatively you can run CDP using your own NodeJS installation by
extracting the source code from the container image. For example,
using Docker:

```bash
# Extract the source into cdp.js
export container=$(docker create plotter/cdp:latest)
docker cp ${container}:/src/index.js cdp.js
docker rm ${container}
unset container
# Use it
node cdp.js --help
```

The structure of a pipeline file is described below. The source code
of the structure validation may also be followed to verify the
implementation of any given field or option: [here](src/api.ts).

### Input forms

Input forms follow the schema:

**`input`** required **object**, a structure containing a single input
form.

#### `generator`

**`input.generator`** **object**, the input form that generates events
for the pipeline at a fixed rate. This is most useful for testing
pipelines before using the definitive input form.

**`input.generator.name`** required **string**, the name of the events
that the input form will generate.

**`input.generator.seconds`** optional **number** or **string**, the
interval between two consecutive events generated by the input
form. Defaults to `1` for one second.

#### `stdin`

**`input.stdin`** **object** or **null**, the input form that makes a
pipeline read source data from standard input.

**`input.stdin.wrap`** optional **string** or **object**, a wrapping
directive which specifies that incoming data is not encoded events,
and thus should be wrapped.

**`input.stdin.wrap.name`** required **string**, the name given to the
events that wrap the input data.

**`input.stdin.wrap.raw`** optional **boolean**, whether to treat
incoming data as plain text, not JSON.

#### `tail`

**`input.tail`** **string** or **object**, the input form that makes a
pipeline read source data from (the tail of) a file. If given a
string, it will be interpreted as the path to the file to be read.

**`input.tail.path`** required **string**, the path to the file to be
read.

**`input.tail.start-at`** optional **"start"** or **"end"**, a mode
indicating whether the file should first be read from the beginning or
the end. To prevent event duplication after a restart of CDP, this is
set to **"end"** by default. Note: this doesn't alter the direction of
reading (which is always "forward"), only the point in the target file
where reading should begin.

**`input.tail.wrap`** optional **string** or **object**, a wrapping
directive which specifies that incoming data is not encoded events,
and thus should be wrapped.

**`input.tail.wrap.name`** required **string**, the name given to the
events that wrap the input data.

**`input.tail.wrap.raw`** optional **boolean**, whether to treat
incoming data as plain text, not JSON.

#### `http`

**`input.http`** **object** or **string**, the input form that makes a
pipeline receive source data from HTTP POST requests. If given as a
string, it indicates the path that will receive requests with source data.

**`input.http.endpoint`** required **string**, indicates the path that
will receive requests with source data.

**`input.http.port`** optional **number** or **string**, indicates the
numeric TCP port to listen on. The default value is determined by the
`HTTP_SERVER_DEFAULT_PORT` variable, and it has a default value of
`8000`.

**`input.http.wrap`** optional **string** or **object**, a wrapping
directive which specifies that incoming data is not encoded events,
and thus should be wrapped.

**`input.http.wrap.name`** required **string**, the name given to the
events that wrap the input data.

**`input.http.wrap.raw`** optional **boolean**, whether to treat
incoming data as plain text, not JSON.

#### `poll`

**`input.poll`** **object** or **string**, the input form that makes a
pipeline actively fetch data periodically from a remote source using
HTTP requests.. If given as a string, it indicates the URI of the
remote event source.

**`input.poll.target`** required **string**, the target URI to use for
the event-fetching request.

**`input.poll.seconds`** optional **number** or **string**, the time
interval between two consecutive fetch requests. If omitted it will
default to the value of the `POLL_INPUT_DEFAULT_INTERVAL` environment
variable, or `5` if the variable is not set.

**`input.poll.headers`** optional **object**, HTTP headers to use for
each request.

**`input.poll.wrap`** optional **string** or **object**, a wrapping
directive which specifies that incoming data is not encoded events,
and thus should be wrapped.

**`input.poll.wrap.name`** required **string**, the name given to the
events that wrap the input data.

**`input.poll.wrap.raw`** optional **boolean**, whether to treat
incoming data as plain text, not JSON.

#### Wrapping

All input forms and some step functions offer the option of wrapping
the captured data with the `wrap` option. It indicates whether the
data captured is considered to be the raw JSON-encoded data or raw
UTF-8 encoded strings and should be wrapped in events with the
specified name. If not given, captured data must be fully JSON-encoded
events.

For example, if receiving data such as `{"this": "is my data"}` is to
be supported, a wrapper would need to be used since the data doesn't
comply with the [event
format](#what-cdp-understands-by-data). Moreover, if the data received
is something like `this is my data` (a plain UTF-8 text), then the
`raw` wrapping would be needed.

### Step dependencies

Step dependencies are speficied as a list of step names that provide
events for the one including the dependencies.

**`steps.<name>.after`** optional **list of string**, names of steps
that will be run before this step, and which will feed their output
events to this step. The `$input` name can be used in this list to
refer to the pipeline's input.

Not specifying any dependency or leaving it as an empty list is
equivalent to the singleton list `["$input"]`.

Any two steps that aren't in a direct or transitive dependency
relationship _can_ process events in parallel.

In a pipeline, steps form a
[DAG](https://en.wikipedia.org/wiki/Directed_acyclic_graph): no cycles
are allowed.

### Pattern matching

Steps can be set to filter events before processing by using
_patterns_. Filtering can also be set to drop events entirely for any
following step, or to simply skip the current step's processing but
fast-forward to the following steps.

**`steps.<name>.match/drop`** optional **pattern**, configures the
step to drop events with names not matching the pattern
specified. Events dropped this way won't be received by steps that
follow the one containing the pattern.

**`steps.<name>.match/pass`** optional **pattern**, configures the
step to skip events with names not matching the pattern
specified. Events skipped this way will still be received by steps
that follow the one containing the pattern.

Any pipeline step can specify at most one of `match/drop` or
`match/pass`.

A **pattern** is a structure defined inductively:
1. A **string** is a pattern that matches event names equal to it,
   considering that `*` can be used in a pattern as a wildcard for any
   word in an event name, and `#` can be used in a pattern as a
   wildcard for any sequence of words in an event name (including a
   zero-length sequence). Event names and string patterns can be
   understood as the same as [RabbitMQ's binding and routing
   keys](https://www.rabbitmq.com/tutorials/tutorial-five-python.html).
1. An **object** with an `or` key mapped to a **list of pattern** is a
   pattern, that matches if any of the patterns in the list mapped to
   `or` matches.
1. An **object** with an `and` key mapped to a **list of pattern** is
   a pattern, that matches if all of the patterns in the list mapped
   to `and` matches.
1. An **object** with a `not` key mapped to a **pattern** is a
   pattern, that matches if the pattern mapped to `not` doesn't match.

A few examples:

```yaml
steps:
  foo:
    # A string pattern
    match/pass: "foo.#.bar.*"
    # ...

  bar:
    # A composite pattern
    match/drop:
      not:
        and:
          - "foo.bar.*.*"
          - "#.baz"
          - or:
            - "#.hey.*"
            - "#.hi.*"
    # ...

```

### Vector definitions

All steps in CDP operate over vectors (i.e. groups, or _windows_) of
events. If not configured, a step will operate over singleton
vectors. Using the `window` field, however, the pipeline author may
configure a step to process more than one event at a time.

**`steps.<name>.window`** optional **object**, contains the
specification for assembling event vectors for processing.

**`steps.<name>.window.events`** required **number** or **string**, a
maximum quantity of events to accumulate in each vector before sending
it to be processed.

**`steps.<name>.window.seconds`** required **number** or **string**, a
maximum number of seconds to wait after receiving the first event of
the vector, for the vector to "fill up". The vector will be sent for
processing after either reaching the cardinality specified in
`window.events` or this time interval.

When using a non-default configuration for vector construction, a
pipeline's author should consider the "main event of the vector" to be
the first one, especially when using the `flatmap` processing mode
(explained further below).

An example:

```yaml
steps:
  foo:
    # Wait for 100 events or 1.5 seconds, whatever happens first.
    window:
      events: 100
      seconds: 1.5
    # ...

```

Vector construction is mainly a tool to control flow rate, but can
also be used to compute moving aggregates over your data.

### Processing modes

A pipeline step can be set to process event vectors in one of two
ways: by operating on disjoint vectors, or by _sliding_ through
superimposed vectors. These modes of processing are called **reduce**
and **flatmap** respectively.

**`steps.<name>.reduce`** **object**, indicates the processing
function to use in reduce mode.

**`steps.<name>.flatmap`** **object**, indicates the processing
function to use in flatmap mode.

One of the modes must be used.

The following example illustrates the difference between the two
modes. Given the partial pipeline file:

```yaml
steps:
  foo:
    window:
      events: 3
      seconds: 1
    reduce:
      send-stdout:
        jq-expr: .

  bar:
    window:
      events: 3
      seconds: 1
    flatmap:
      send-stdout:
        jq-expr: .

```

The only difference between `foo` and `bar` is the operation mode. If
receiving as input events **A**, **B**, **C**, **D**, and **E**, the
step `foo` would print to stdout two vectors: **(A, B, C)** and **(D,
E)**. The step `bar` would print five vectors: **(A, B, C)**, **(B, C,
D)**, **(C, D, E)**, **(D, E)** and finally **(E)**.

In general, the use of `flatmap` implies much more processing load.

### Processing functions

The step functions themselves (keyed under `reduce` or `flatmap`) come
from a fixed list of options:

#### `rename`

**`steps.<name>.(reduce|flatmap).rename`** **object**, a function that
renames events it receives.

**`steps.<name>.(reduce|flatmap).rename.replace`** **string**, the
name that will be assigned to events going through this step.

**`steps.<name>.(reduce|flatmap).rename.append`** optional **string**,
a suffix to add to event names going though this step.

**`steps.<name>.(reduce|flatmap).rename.prepend`** optional
**string**, a prefix to add to event names going through this step.

The `rename` function can only be given the `replace` option or a
combination of the `append` and `prepend` options.

#### `deduplicate`

**`steps.<name>.(reduce|flatmap).deduplicate`** **object** or
**null**, a function that removes duplicate events from vectors.

**`steps.<name>.(reduce|flatmap).deduplicate.consider-name`** optional
**boolean**, defaults to `true`, indicates whether deduplication
should consider the name of events.

**`steps.<name>.(reduce|flatmap).deduplicate.consider-data`** optional
**boolean**, defaults to `true`, indicates whether deduplication
should consider the data contained in events.

**`steps.<name>.(reduce|flatmap).deduplicate.consider-trace`**
optional **boolean**, defaults to `false`, indicates whether
deduplication should consider the trace of events.

Setting all three of these to `false` is equivalent to using the
below-explained `keep` with value `1`, that is, dropping all events
from each group except for the first one.

#### `keep`

**`steps.<name>.(reduce|flatmap).keep`** **number** or **string**, a
function that selects the first few events from an event vector, the
number of events kept being the specified value.

#### `keep-when`

**`steps.<name>.(reduce|flatmap).keep-when`** **object**, a function that
selects events from an event vector, according to whether their data
complies with the schema given. The schema should be a valid [JSON
Schema object](https://json-schema.org/specification.html).

#### `send-stdout`

**`steps.<name>.(reduce|flatmap).send-stdout`** **object** or
**null**, a function that always sends forward the events in the
vectors it receives, unmodified. It also prints the events to STDOUT.

**`steps.<name>.(reduce|flatmap).send-stdout.jq-expr`** optional
**string**, specifies a `jq` filter to apply before sending events to
STDOUT.

#### `send-file`

**`steps.<name>.(reduce|flatmap).send-file`** **object** or
**string**, a function that always sends forward the events in the
vectors it receives, unmodified. It also appends the events to the
specified file, which is given directly as a path or a configuration
object.

**`steps.<name>.(reduce|flatmap).send-file.path`** required
**string**, the path to the file that will receive events.

**`steps.<name>.(reduce|flatmap).send-file.jq-expr`** optional
**string**, specifies a `jq` filter to apply before appending events
to the specified file.

#### `send-http`

**`steps.<name>.(reduce|flatmap).send-http`** **string** or
**object**, a function that always sends forward the events in the
vectors it receives, unmodified. It also sends those vectors to the
specified HTTP target, using a POST request. If given a string, the
value is taken to be target URI to use for the event-sending request.

**`steps.<name>.(reduce|flatmap).send-http.target`** required
**string**, the target URI to use for the event-sending request.

**`steps.<name>.(reduce|flatmap).send-http.method`** optional
**"POST"** or **"PUT"** or **"PATCH"**, the HTTP method to use for the
event-sending request. Defaults to **"POST"**.

**`steps.<name>.(reduce|flatmap).send-http.jq-expr`** optional
**string**, an optional `jq` filter to apply to events before creating
the request. If this option is used, each distinct value produced by
the filter is used for a separate request. If this option is not used,
each event vector produces a request, and the content type header of
the request is forced to `application/x-ndjson`.

**`steps.<name>.(reduce|flatmap).send-http.headers`** optional
**object**, additional HTTP headers to use for the request. If not
using the `jq-expr` option, the request content type cannot be
altered.

#### `send-receive-jq`

**`steps.<name>.(reduce|flatmap).send-receive-jq`** **string** or
**object**, a function that sends the event vector to `jq` for
processing, and parses its output and produces new events. If given a
string, it's used as the `jq` filter.

**`steps.<name>.(reduce|flatmap).send-receive-jq.jq-expr`** required
**string**, the `jq` filter to use.

**`steps.<name>.(reduce|flatmap).send-receive-jq.wrap`** optional
**string** or **object**, a wrapping directive which specifies that
incoming data from `jq` is not encoded events, and thus should be
wrapped. See [wrapping](#wrapping).

**`steps.<name>.(reduce|flatmap).send-receive-jq.wrap.name`** required
**string**, the name given to the events that wrap the received data.

**`steps.<name>.(reduce|flatmap).send-receive-jq.wrap.raw`** optional
**boolean**, whether to treat received data as plain text, not JSON.

#### `send-receive-http`

**`steps.<name>.(reduce|flatmap).send-receive-http`** **string** or
**object**, a function that sends event vectors to the specified HTTP
target, using a POST request. If given a string, the value is taken to
be target URI to use for the event-sending request. The response
received is parsed to be the transformed events, which will continue
the next steps in the pipeline.

**`steps.<name>.(reduce|flatmap).send-receive-http.target`** required
**string**, the target URI to use for the event-sending request.

**`steps.<name>.(reduce|flatmap).send-receive-http.method`** optional
**"POST"** or **"PUT"** or **"PATCH"**, the HTTP method to use for the
event-sending request. Defaults to **"POST"**.

**`steps.<name>.(reduce|flatmap).send-receive-http.jq-expr`** optional
**string**, an optional `jq` filter to apply to events before creating
the request. If this option is used, each distinct value produced by
the filter is used for a separate request. If this option is not used,
each event vector produces a request, and the content type header of
the request is forced to `application/x-ndjson`.

**`steps.<name>.(reduce|flatmap).send-receive-http.headers`** optional
**object**, additional HTTP headers to use for the request. If not
using the `jq-expr` option, the request content type cannot be
altered.

**`steps.<name>.(reduce|flatmap).send-receive-http.wrap`** optional
**string** or **object**, a wrapping directive which specifies that
incoming data from the HTTP response is not encoded events, and thus
should be wrapped. See [wrapping](#wrapping).

**`steps.<name>.(reduce|flatmap).send-receive-http.wrap.name`**
required **string**, the name given to the events that wrap the
received data.

**`steps.<name>.(reduce|flatmap).send-receive-http.wrap.raw`**
optional **boolean**, whether to treat received data as plain text,
not JSON.

#### About `jq` expressions

Several step processing functions have the option of using
[`jq`](https://stedolan.github.io/jq/) as a pre-processing step
(typically under a `jq-expr` option). This can be used to change the
format of events ahead of time, and can also be used to communicate in
plain text formats (i.e. non-JSON). To do that, simply return string
values from your `jq` filters.

**Note**: CDP tries to protect the adjacent `jq` processes by wrapping
all filters with a
[`try`](https://stedolan.github.io/jq/manual/#try-catch) form. Runtime
errors will thus be silently skipped over, so it can be very important
to always test your `jq` filters in controlled environments.

### Metrics

Any running instance of CDP can expose operation metrics, which can be
checked by accessing <http://localhost:8001/metrics> by default (the
path and port can be changed with the `METRICS_EXPOSITION_PATH` and
`METRICS_EXPOSITION_PORT` variables; set `METRICS_EXPOSITION_PATH` to
an empty string to disable exposition). Metrics are exposed in the
[open metrics
format](https://github.com/OpenObservability/OpenMetrics), so they
should be able to be scraped by a Prometheus instance without issue.

### Additional configuration

A CDP program can be further configured with certain environment
variables. These parameters can't be placed inside the pipeline
file. The whole list of environment variables read and used can be
found in the [source](src/conf.ts).
