"""Redis-optional cache for built symbol graphs.

Always keeps an in-memory copy keyed by ``(project_id, commit)``. When
``REDIS_URL`` is configured we additionally mirror the serialised graph to
``cache:symbolgraph:{project}:{commit}`` (data-model §6, 24h TTL). Redis is a
best-effort accelerator: any Redis error is swallowed so the service keeps
working from memory.
"""

from __future__ import annotations

import json
import logging
import threading

from .graph import SymbolGraph
from .settings import settings

logger = logging.getLogger("analysis.cache")

_TTL_SECONDS = 24 * 60 * 60  # data-model §6: cache:symbolgraph TTL = 24h


def _redis_key(project_id: str, commit: str) -> str:
    return f"cache:symbolgraph:{project_id}:{commit}"


class GraphCache:
    """Two-tier cache: process memory + optional Redis mirror."""

    def __init__(self) -> None:
        self._mem: dict[tuple[str, str], SymbolGraph] = {}
        self._lock = threading.RLock()
        self._redis = self._connect_redis()

    # ------------------------------------------------------------------ redis
    def _connect_redis(self):  # noqa: ANN201
        if not settings.redis_url:
            logger.info("REDIS_URL not set — running with in-memory cache only.")
            return None
        try:
            import redis  # type: ignore

            client = redis.Redis.from_url(
                settings.redis_url,
                socket_connect_timeout=2,
                socket_timeout=2,
                decode_responses=True,
            )
            client.ping()
            logger.info("Connected to Redis at %s", settings.redis_url)
            return client
        except Exception as exc:
            logger.warning("Redis unavailable (%s); using in-memory cache only.", exc)
            return None

    @property
    def redis_connected(self) -> bool:
        if self._redis is None:
            return False
        try:
            self._redis.ping()
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------ api
    def put(self, graph: SymbolGraph) -> None:
        key = (graph.project_id, graph.commit)
        with self._lock:
            self._mem[key] = graph
        if self._redis is not None:
            try:
                payload = json.dumps(graph.to_dict())
                self._redis.set(
                    _redis_key(graph.project_id, graph.commit),
                    payload,
                    ex=_TTL_SECONDS,
                )
            except Exception as exc:  # pragma: no cover - network dependent
                logger.warning("Redis write failed: %s", exc)

    def get(self, project_id: str, commit: str) -> SymbolGraph | None:
        key = (project_id, commit)
        with self._lock:
            if key in self._mem:
                return self._mem[key]
        # Fall back to Redis and re-hydrate into memory.
        if self._redis is not None:
            try:
                raw = self._redis.get(_redis_key(project_id, commit))
                if raw:
                    graph = SymbolGraph.from_dict(json.loads(raw))
                    with self._lock:
                        self._mem[key] = graph
                    return graph
            except Exception as exc:  # pragma: no cover
                logger.warning("Redis read failed: %s", exc)
        return None


# Shared singleton.
graph_cache = GraphCache()
