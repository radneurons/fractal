"""In-process event bus. Topics are plain strings ("engine:<id>", "tournament:<id>", "hw", ...).

WebSocket clients and the public broadcast channels subscribe here; producers never
block on slow consumers (bounded queues, oldest messages dropped for that subscriber).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator


class Subscription:
    def __init__(self, bus: "EventBus", topics: set[str], maxsize: int = 512):
        self.bus, self.topics = bus, topics
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize)
        self.dropped = 0

    def matches(self, topic: str) -> bool:
        if "*" in self.topics or topic in self.topics:
            return True
        head = topic.split(":", 1)[0]
        return head + ":*" in self.topics

    def push(self, msg: dict[str, Any]) -> None:
        if self.queue.full():
            try:
                self.queue.get_nowait()
                self.dropped += 1
            except asyncio.QueueEmpty:
                pass
        self.queue.put_nowait(msg)

    async def __aiter__(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            yield await self.queue.get()

    def close(self) -> None:
        self.bus._subs.discard(self)


class EventBus:
    def __init__(self) -> None:
        self._subs: set[Subscription] = set()
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, *topics: str, maxsize: int = 512) -> Subscription:
        sub = Subscription(self, set(topics), maxsize)
        self._subs.add(sub)
        return sub

    def publish(self, topic: str, type_: str, data: Any = None) -> None:
        msg = {"topic": topic, "type": type_, "data": data, "ts": time.time()}
        for sub in list(self._subs):
            if sub.matches(topic):
                sub.push(msg)

    def publish_threadsafe(self, topic: str, type_: str, data: Any = None) -> None:
        if self._loop and self._loop.is_running():
            self._loop.call_soon_threadsafe(self.publish, topic, type_, data)
        else:
            self.publish(topic, type_, data)


bus = EventBus()
