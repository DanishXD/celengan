"""Append-only audit log.

Every consent change, action request, policy decision, receipt and undo is
appended as one JSON line. The log is intentionally append-only: it can be
replayed to reconstruct the session (competition requirement: execution
evidence + auditability).
"""

from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path


class AuditLog:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._events: list[dict] = []
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: str, **details) -> dict:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "event": event,
            **details,
        }
        with self._lock:
            self._events.append(entry)
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    def tail(self, limit: int = 100) -> list[dict]:
        with self._lock:
            return list(self._events[-limit:])

    def __len__(self) -> int:
        return len(self._events)
