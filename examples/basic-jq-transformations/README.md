# Example: Basic `jq` transformations

This example illustrates the use of
[jq](https://stedolan.github.io/jq/) inside a pipeline definition for
basic tasks.

The example is interactive. To run it, use:

```bash
docker compose run --rm cdp
```

And type in various events into standard input. Optionally, you may
use the given test event file to try a few:

```bash
docker compose run --rm -T cdp < test-events.ndjson
```
