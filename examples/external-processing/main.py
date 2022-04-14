"""This is a dead-simple FastAPI application that calculates the
result of some one-argument function from the math module (e.g. sin,
or log2). It's not meant to be an example for good FastAPI
applications.

"""

import inspect
import json
import math
import os
from typing import List, Generator
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI()

# Fail early if the configured function doesn't exist, or isn't of
# arity one.
expression = os.getenv("EXPR")
fn = getattr(math, expression)
assert (
    len(inspect.signature(fn).parameters) == 1
), f"Function {expression} doesn't expect exactly one argument"


class Value(BaseModel):
    """A wrapped input value."""

    x: float


def calculate_iter(values: List[Value]) -> Generator[dict, None, None]:
    """Calculate and yield results when possible."""
    for value in values:
        try:
            yield {**value.dict(), expression: fn(value.x)}
        except ValueError:
            print(f"Value is not a valid input for {expression}(x)", value.x)


@app.post("/calculate")
def calculate(values: List[Value]) -> List[dict]:
    """Return an ndjson response with the calculation results."""
    return StreamingResponse(
        (json.dumps(result, separators=(",", ":")) + "\n").encode("utf8")
        for result in calculate_iter(values)
    )
