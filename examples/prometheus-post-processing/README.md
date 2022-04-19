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
course, those same metrics are in turn scraped by the prometheus
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

TODO write this

## Pipeline file

A copy of the [pipeline file](pipeline.yaml) is included here for
convenience.

```yaml
TODO include pipeline file
```
