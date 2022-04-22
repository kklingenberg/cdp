# Example: Filebeat look-alike and OpenSearch

This examples illustrates a setup similar to the use of
[Filebeat](https://www.elastic.co/beats/filebeat) (but much more
limited) with forwarding to an [OpenSearch](https://opensearch.org/)
instance.

**Disclaimer**: this example doesn't advocate for the use of CDP over
Filebeat for log-shipping purposes. Filebeat is much more mature and
robust, and is almost always the right choice when the log destination
is OpenSearch, Logstash or Elasticsearch.

The example runs on its own. To start it, use:

```bash
docker compose up -d
```

And then log into the OpenSearch Dashboards to check the events sent
by CDP: <http://localhost:5601> user `admin` and password
`admin`. You'll have to create an index pattern that matches the
`events` index.

To stop the example and cleanup, use the `-v` option of docker compose
down:

```bash
# Cleanup volumes
docker compose down -v
```

## What does it do?

The example shows a pipeline that continuosly reads a file for input
("tails" it), all the while another process writes to it. The events
so captured are then sent in a pipeline step to an OpenSearch instance
for storage.

To read the input, the `tail` input form is used. Since the source
file contains plain-text data, the `wrap.raw` option is used.

The events are sent to OpenSearch using a `jq-expr` preprocessing step
on the `send-http` function.

From these components you should observe four things:
1. [The `tail` input form](/../../#tail).
1. [The `wrap.raw` wrapping option](/../../#wrapping), used to
   consider the raw lines from the input file.
1. The use of [windowing](/../../#vector-definitions) to control the
   rate of requests to the OpenSearch instance.
1. The use of [`jq` filters](/../../#about-jq-expressions) to send a
   properly formatted, not-quite-JSON request to OpenSearch.

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
---
name: "Logs to OpenSearch"

input:
  tail:
    path: /var/log/shared-logs/access.log
    wrap:
      name: nginx
      raw: true

steps:

  send to opensearch:
    window:
      events: 1000
      seconds: 10
    reduce:
      send-http:
        target: https://opensearch:9200/events/_bulk
        headers:
          Content-Type: application/x-ndjson
          Authorization: Basic YWRtaW46YWRtaW4=
        # Here the jq JSON-serializing function `tojson` is used, so
        # that it's possible to assemble a single NDJson request body
        # that complies with OpenSearch's specification:
        # https://opensearch.org/docs/latest/opensearch/rest-api/document-apis/bulk/
        jq-expr: |-
          map([{index: {}}, .] | map(tojson) | join("\n")) | join("\n") + "\n"

```
