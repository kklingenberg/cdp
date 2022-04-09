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

## Metrics

Metrics exposed in prometheus exposition format can be checked at
<http://localhost:8000/metrics>.
