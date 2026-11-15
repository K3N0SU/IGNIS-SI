"""Serialise the numerical work of the API.

FastAPI runs synchronous endpoints on a thread pool, so two requests can
execute the solver at the same time. The solver is CPU-bound pure Python and
gains nothing from that, and running it from one thread at a time removes a
class of interpreter-level faults seen under concurrent load. Network waits
(the assistant's calls to its model provider) stay outside the lock.
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")

COMPUTE_LOCK = threading.RLock()


def serial(fn: Callable[P, R]) -> Callable[P, R]:
    @wraps(fn)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        with COMPUTE_LOCK:
            return fn(*args, **kwargs)

    return wrapper
