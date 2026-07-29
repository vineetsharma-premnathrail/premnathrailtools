"""
Rate-limiting store — Redis if available, in-memory fallback.

Set REDIS_URL in .env for distributed deployments:
    REDIS_URL=redis://localhost:6379/0

Without REDIS_URL the app works fine using in-memory dicts (single-instance only).
"""
import time
import logging
from collections import defaultdict
from typing import Protocol

logger = logging.getLogger(__name__)


# ─── Abstract interface ───────────────────────────────────────────────────────

class RateStore(Protocol):
    def is_rate_limited(self, key: str, limit: int, window: float) -> bool: ...
    def record_violation(self, ip: str, ban_duration: float, threshold: int) -> bool: ...
    def is_banned(self, ip: str) -> bool: ...
    def track_scan(self, ip: str, window: float, limit: int) -> bool: ...


# ─── In-memory implementation ─────────────────────────────────────────────────

class InMemoryRateStore:
    def __init__(self) -> None:
        self._rate: dict[str, list[float]] = defaultdict(list)
        self._violations: dict[str, list[float]] = defaultdict(list)
        self._bans: dict[str, float] = {}
        self._scans: dict[str, list[float]] = defaultdict(list)

    def is_rate_limited(self, key: str, limit: int, window: float) -> bool:
        now = time.time()
        self._rate[key] = [t for t in self._rate[key] if now - t < window]
        if len(self._rate[key]) >= limit:
            return True
        self._rate[key].append(now)
        return False

    def record_violation(self, ip: str, ban_duration: float, threshold: int) -> bool:
        now = time.time()
        self._violations[ip] = [t for t in self._violations[ip] if now - t < ban_duration]
        self._violations[ip].append(now)
        if len(self._violations[ip]) >= threshold:
            self._bans[ip] = now + ban_duration
            return True
        return False

    def is_banned(self, ip: str) -> bool:
        expiry = self._bans.get(ip)
        if expiry is None:
            return False
        if time.time() < expiry:
            return True
        del self._bans[ip]
        return False

    def track_scan(self, ip: str, window: float, limit: int) -> bool:
        now = time.time()
        self._scans[ip] = [t for t in self._scans[ip] if now - t < window]
        self._scans[ip].append(now)
        return len(self._scans[ip]) >= limit

    def reset(self) -> None:
        """Test-only helper: wipe all in-memory state between test runs."""
        self._rate.clear()
        self._violations.clear()
        self._bans.clear()
        self._scans.clear()


# ─── Redis implementation ─────────────────────────────────────────────────────

class RedisRateStore:
    def __init__(self, redis_url: str) -> None:
        import redis as _redis
        self._r = _redis.from_url(redis_url, decode_responses=True, socket_timeout=1)
        self._r.ping()
        logger.info("Rate store: Redis connected at %s", redis_url)

    def is_rate_limited(self, key: str, limit: int, window: float) -> bool:
        rkey = f"rl:{key}"
        pipe = self._r.pipeline()
        now = time.time()
        pipe.zremrangebyscore(rkey, 0, now - window)
        pipe.zcard(rkey)
        pipe.zadd(rkey, {str(now): now})
        pipe.expire(rkey, int(window) + 1)
        _, count, *_ = pipe.execute()
        return int(count) >= limit

    def record_violation(self, ip: str, ban_duration: float, threshold: int) -> bool:
        rkey = f"viol:{ip}"
        now = time.time()
        self._r.zremrangebyscore(rkey, 0, now - ban_duration)
        self._r.zadd(rkey, {str(now): now})
        self._r.expire(rkey, int(ban_duration) + 1)
        count = self._r.zcard(rkey)
        if int(count) >= threshold:
            self._r.setex(f"ban:{ip}", int(ban_duration), "1")
            return True
        return False

    def is_banned(self, ip: str) -> bool:
        return bool(self._r.exists(f"ban:{ip}"))

    def track_scan(self, ip: str, window: float, limit: int) -> bool:
        rkey = f"scan:{ip}"
        now = time.time()
        self._r.zremrangebyscore(rkey, 0, now - window)
        self._r.zadd(rkey, {str(now): now})
        self._r.expire(rkey, int(window) + 1)
        return int(self._r.zcard(rkey)) >= limit


# ─── Factory — auto-select based on REDIS_URL env var ────────────────────────

def build_rate_store() -> "InMemoryRateStore | RedisRateStore":
    import os
    redis_url = os.getenv("REDIS_URL", "").strip()
    if redis_url:
        try:
            return RedisRateStore(redis_url)
        except Exception as exc:
            logger.warning("Redis unavailable (%s) — falling back to in-memory rate store", exc)
    logger.info("Rate store: using in-memory (set REDIS_URL for distributed mode)")
    return InMemoryRateStore()
