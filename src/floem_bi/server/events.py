"""Anlık güncelleme (SSE): açık rapor ve uygulama ekranlarına "içerik değişti" bildirimi.

Power BI'da yeniden yayımlanan rapor açık sekmede kendiliğinden yenilenir; burada da
yayımlama/App güncelleme olayları, içeriğe erişimi olan kullanıcıların açık bağlantılarına
gönderilir. Olaylar yalnızca kimlik ve sürüm taşır; içerik istemcinin yetkili isteğiyle okunur.

EventSource başlık gönderemediği için bağlantı, oturumla alınan kısa ömürlü ve tek
kullanımlık bir biletle açılır (JWT adres satırına ve sunucu günlüğüne düşmez).
"""

from __future__ import annotations

import asyncio
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

TICKET_TTL = 60.0


@dataclass(eq=False)
class Subscriber:
    user_id: int
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=100))


class EventHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: set[Subscriber] = set()
        self._tickets: dict[str, tuple[int, float]] = {}

    # ------------------------------------------------------------ biletler
    def ticket(self, user_id: int) -> str:
        now = time.monotonic()
        t = secrets.token_urlsafe(24)
        with self._lock:
            self._tickets = {k: v for k, v in self._tickets.items() if v[1] > now}
            self._tickets[t] = (user_id, now + TICKET_TTL)
        return t

    def redeem(self, ticket: str) -> int | None:
        with self._lock:
            v = self._tickets.pop(ticket, None)
        if v is None or v[1] < time.monotonic():
            return None
        return v[0]

    # ------------------------------------------------------------ abonelik
    def subscribe(self, user_id: int) -> Subscriber:
        sub = Subscriber(user_id, asyncio.get_running_loop())
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    @property
    def count(self) -> int:
        return len(self._subs)

    def emit(self, event: dict, allowed: Callable[[int], bool]) -> int:
        """Olayı erişimi olan abonelere iletir (herhangi bir iş parçacığından çağrılabilir)."""
        with self._lock:
            subs = list(self._subs)
        decided: dict[int, bool] = {}
        sent = 0
        for s in subs:
            if s.user_id not in decided:
                decided[s.user_id] = allowed(s.user_id)
            if not decided[s.user_id]:
                continue
            try:
                s.loop.call_soon_threadsafe(_put, s.queue, event)
                sent += 1
            except RuntimeError:          # döngü kapanmış: bağlantı zaten bitti
                self.unsubscribe(s)
        return sent


def _put(q: asyncio.Queue, event: dict) -> None:
    if q.full():                          # yavaş istemci: en eski olayı at
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
    q.put_nowait(event)
