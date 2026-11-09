import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Hashable


class RateLimiter:
    """Anahtar başına kayan pencereli basit istek limiti (tek süreç için, bellek içi).

    Birden fazla sunucu örneğine geçildiğinde Redis tabanlı bir limitleyiciyle değiştirilmeli.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: Dict[Hashable, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: Hashable) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
