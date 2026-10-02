import logging
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger(__name__)


class LiveHub:
    def __init__(self) -> None:
        self._subs: dict[int, set[WebSocket]] = defaultdict(set)

    def subscribe(self, session_id: int, ws: WebSocket) -> None:
        self._subs[session_id].add(ws)

    def unsubscribe(self, session_id: int, ws: WebSocket) -> None:
        subs = self._subs.get(session_id)
        if subs is None:
            return
        subs.discard(ws)
        if not subs:
            del self._subs[session_id]

    async def publish(self, session_id: int, message: dict) -> None:
        for ws in list(self._subs.get(session_id, ())):
            try:
                await ws.send_json(message)
            except Exception:
                log.info("dropping dead websocket for session %s", session_id)
                self.unsubscribe(session_id, ws)
