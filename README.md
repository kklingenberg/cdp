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
  [restricted to a specific scheme]().
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
directory](examples/README.md).

## Usage

TODO write about this.
