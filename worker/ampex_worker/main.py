"""Worker-løkka: meld inn PC-en én gang, kjør deretter bakes fra firmaets kø.

    python -m ampex_worker.main enroll --url <supabase> --anon <key> --code <kode>
    python -m ampex_worker.main run
"""
from __future__ import annotations

import argparse
import logging
import platform
import shutil
import socket
import tempfile
import threading
import time
from pathlib import Path

from .api import Api, NodeConfig
from .bake import BakeConfig, BakeResult, bake

VERSION = "0.1.0"
LEASE_SECONDS = 300
IDLE_SLEEP = 15.0

log = logging.getLogger("ampex.worker")


def gpu_name() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:  # noqa: BLE001 — kun kosmetikk i node-lista
        pass
    return "ukjent"


class Heartbeat:
    """Fornyer leaset mens baken kjører. Uten dette requeues jobben midt i."""

    def __init__(self, api: Api, job_id: str, interval: float = 60.0):
        self.api, self.job_id, self.interval = api, job_id, interval
        self.progress = 0.0
        self._stop = threading.Event()
        self._t = threading.Thread(target=self._loop, daemon=True)

    def _loop(self) -> None:
        while not self._stop.wait(self.interval):
            try:
                self.api.heartbeat(self.job_id, self.progress, LEASE_SECONDS)
            except Exception as exc:  # noqa: BLE001
                log.warning("heartbeat feilet: %s", exc)

    def __enter__(self):
        self._t.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()


def run_one(api: Api, job: dict) -> None:
    job_id = job["id"]
    log.info("tok jobb %s (pool=%s)", job_id, job.get("pool"))
    work = Path(tempfile.mkdtemp(prefix=f"ampex-{job_id[:8]}-"))
    try:
        with Heartbeat(api, job_id) as hb:
            frames = api.download_frames(job_id, work / "frames")
            hb.progress = 0.1

            def on_stage(msg: str, _ms: int) -> None:
                hb.progress = min(0.95, hb.progress + 0.12)
                log.info("  %s", msg)

            out = work / "scan.glb"
            t0 = time.time()
            result: BakeResult = bake(frames, out, BakeConfig(), progress=on_stage)
            gpu_ms = int((time.time() - t0) * 1000)

            key = api.upload_glb(job_id, result.glb_path)
            api.complete(job_id, key, gpu_ms, result.filled_fraction)
            log.info("ferdig %s — fylt %.1f%%, %d ms",
                     job_id, result.filled_fraction * 100, gpu_ms)
    except Exception as exc:  # noqa: BLE001 — enhver feil skal tilbake i køen
        log.exception("jobb %s feilet", job_id)
        try:
            api.fail(job_id, f"{type(exc).__name__}: {exc}")
        except Exception:  # noqa: BLE001
            log.error("klarte ikke melde feil for %s", job_id)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def cmd_run(_args) -> int:
    cfg = NodeConfig.load()
    if not cfg:
        log.error("ikke innmeldt — kjør 'enroll' først")
        return 1
    api = Api(cfg)
    log.info("worker %s klar (%s)", VERSION, gpu_name())
    while True:
        try:
            job = api.claim(LEASE_SECONDS)
        except Exception as exc:  # noqa: BLE001 — nettverk er ikke fatalt
            log.warning("claim feilet: %s", exc)
            time.sleep(IDLE_SLEEP)
            continue
        if job is None:
            time.sleep(IDLE_SLEEP)
            continue
        run_one(api, job)


def cmd_enroll(args) -> int:
    token = Api.enroll(args.url, args.anon, args.code,
                       socket.gethostname(), gpu_name(), VERSION)
    NodeConfig(args.url, args.anon, token).save()
    log.info("innmeldt som %s — token lagret", socket.gethostname())
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="ampex-worker")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enroll", help="meld inn denne PC-en i firmaets pool")
    e.add_argument("--url", required=True)
    e.add_argument("--anon", required=True)
    e.add_argument("--code", required=True, help="engangskode fra appen")
    e.set_defaults(fn=cmd_enroll)

    r = sub.add_parser("run", help="kjør bakes fra køen")
    r.set_defaults(fn=cmd_run)

    args = ap.parse_args()
    log.info("plattform: %s", platform.platform())
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
