"""Small in-process sliding-window limiter for low-volume public endpoints."""
from collections import deque
from math import ceil
from threading import Lock
from time import monotonic


class SlidingWindowRateLimiter:
    def __init__(self, *, limit: int, window_seconds: int):
        if limit < 1 or window_seconds < 1:
            raise ValueError('Rate limit and window must be positive.')
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = {}
        self._lock = Lock()

    def consume(self, key: str) -> int | None:
        now = monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            requests = self._requests.get(key)
            if requests is None:
                requests = deque()
                self._requests[key] = requests
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if len(requests) >= self.limit:
                return max(1, ceil(self.window_seconds - (now - requests[0])))
            requests.append(now)
            if len(self._requests) > 4096:
                for request_key, bucket in list(self._requests.items()):
                    while bucket and bucket[0] <= cutoff:
                        bucket.popleft()
                    if not bucket:
                        self._requests.pop(request_key, None)
            return None
