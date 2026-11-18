"""Arka plan işleri (içe aktarım, yenileme).

Her iş tablo tablo ilerleme, durum ve okunur hata tutar. Aynı yapı floembi.app'teki
gateway yenilemelerinde de kullanılacak ("Yenileme geçmişi").
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable

from ..connectors import ConnectorError
from ..importer.loader import Cancelled
from ..model.semantic import ModelError
from .floemfile import FloemFileError


class JobConflict(Exception):
    """Aynı anda yalnızca bir içe aktarım/yenileme çalışabilir."""


@dataclass
class JobTable:
    name: str
    label: str                       # kaynakta nerede: dbo.OINV ya da "SQL sorgusu"
    status: str = "pending"          # pending | running | done | failed | cancelled
    rows: int = 0
    error: dict | None = None


@dataclass
class Job:
    kind: str                        # import | refresh
    doc_id: str
    tables: list[JobTable]
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    status: str = "running"          # running | succeeded | failed | cancelled
    started: float = field(default_factory=time.time)
    finished: float | None = None
    error: dict | None = None
    result: dict[str, Any] = field(default_factory=dict)
    on_cancel: Callable[[], None] | None = None
    _cancel: threading.Event = field(default_factory=threading.Event)

    def cancel(self) -> None:
        self._cancel.set()
        if self.on_cancel:
            self.on_cancel()

    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def to_dict(self) -> dict:
        end = self.finished or time.time()
        return {
            "id": self.id,
            "kind": self.kind,
            "status": self.status,
            "elapsed_ms": int((end - self.started) * 1000),
            "tables": [t.__dict__ for t in self.tables],
            "error": self.error,
            "result": self.result,
        }


def error_dict(e: BaseException) -> dict:
    if isinstance(e, (ConnectorError, FloemFileError)):
        return {"code": getattr(e, "code", "error"), "message": e.message, "detail": e.detail}
    if isinstance(e, ModelError):
        return {"code": "model_error", "message": str(e), "detail": ""}
    tb = "".join(traceback.format_exception(type(e), e, e.__traceback__)[-4:])
    return {"code": "error", "message": f"Beklenmeyen hata: {e}", "detail": tb}


class JobRunner:
    def __init__(self, keep: int = 20):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._keep = keep

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def active(self) -> Job | None:
        return next((j for j in self._jobs.values() if j.status == "running"), None)

    def start(self, job: Job, fn: Callable[[Job], None]) -> Job:
        with self._lock:
            if self.active():
                raise JobConflict("Başka bir içe aktarım ya da yenileme sürüyor")
            self._jobs[job.id] = job
            for old in list(self._jobs)[: -self._keep]:
                if self._jobs[old].status != "running":
                    del self._jobs[old]

        def run() -> None:
            try:
                fn(job)
                job.status = "cancelled" if job.cancelled() else "succeeded"
            except Cancelled:
                job.status = "cancelled"
                for t in job.tables:
                    if t.status in ("pending", "running"):
                        t.status = "cancelled"
            except BaseException as e:  # noqa: BLE001 - hatayı kullanıcıya gösteriyoruz
                if job.cancelled():
                    job.status = "cancelled"
                else:
                    job.error = error_dict(e)
                    job.status = "failed"
                for t in job.tables:
                    if t.status == "running":
                        t.status = "failed" if job.status == "failed" else "cancelled"
                        if job.status == "failed":
                            t.error = job.error
                    elif t.status == "pending":
                        t.status = "cancelled"
            finally:
                job.finished = time.time()
                job.on_cancel = None

        threading.Thread(target=run, name=f"floem-job-{job.id}", daemon=True).start()
        return job

    def wait(self, job: Job, timeout: float = 60) -> Job:
        """Testler için: iş bitene kadar bekler."""
        end = time.time() + timeout
        while job.status == "running" and time.time() < end:
            time.sleep(0.02)
        return job
