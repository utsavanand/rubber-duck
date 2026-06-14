"""The live event tier: a bounded ring of recent events plus async fan-out to
SSE subscribers. Every event gets an _id and _ts on publish.

This is the in-memory tier only. Act 2 adds a durable SQLite mirror by passing a
sink to publish(); until then events live only for the process lifetime.
"""

import asyncio
import sys
import time
import uuid
from collections import deque
from collections.abc import Callable
from types import TracebackType
from typing import Any

Event = dict[str, Any]
Sink = Callable[[Event], None]


class Subscription:
    """A live feed of events published after it was opened. The queue registers
    eagerly at construction, so no event is lost between subscribe() and the
    first read. Use as an async context manager to guarantee deregistration."""

    def __init__(self, bus: "EventBus") -> None:
        self._bus = bus
        self._queue: asyncio.Queue[Event] = asyncio.Queue()
        bus._subscribers.add(self._queue)

    async def next(self) -> Event:
        return await self._queue.get()

    def close(self) -> None:
        self._bus._subscribers.discard(self._queue)

    def __enter__(self) -> "Subscription":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.close()


class EventBus:
    def __init__(self, capacity: int = 500, sink: Sink | None = None) -> None:
        self._ring: deque[Event] = deque(maxlen=capacity)
        self._subscribers: set[asyncio.Queue[Event]] = set()
        self._sink = sink

    def publish(self, raw: Event) -> Event:
        """Stamp the event with _id/_ts, append to the ring buffer, mirror it to
        the sink (persistence), and fan it out to subscribers. Returns the
        stamped event. A sink failure is logged, not raised."""
        event = dict(raw)
        event["_id"] = uuid.uuid4().hex
        event["_ts"] = int(time.time() * 1000)
        self._ring.append(event)
        if self._sink is not None:
            # A persistence failure must not break the live stream or the
            # request; the event still reaches the ring and SSE subscribers.
            try:
                self._sink(event)
            except Exception as exc:  # noqa: BLE001 - sink is untrusted at this boundary
                print(f"[rubberduck] event sink failed: {exc}", file=sys.stderr)
        for queue in self._subscribers:
            queue.put_nowait(event)
        return event

    def recent(self, limit: int = 100) -> list[Event]:
        """The most recent `limit` events from the ring buffer, oldest first."""
        if limit >= len(self._ring):
            return list(self._ring)
        return list(self._ring)[-limit:]

    def subscribe(self) -> Subscription:
        """A live subscription that yields every event published from now on."""
        return Subscription(self)

    @property
    def subscriber_count(self) -> int:
        """Number of open live subscriptions."""
        return len(self._subscribers)
