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
from .gpu import compute_capability, gpu_name, vram_mb
from .konfig import DEFAULT_ANON_KEY, DEFAULT_SUPABASE_URL

VERSION = "0.1.0"
LEASE_SECONDS = 300
IDLE_SLEEP = 15.0

log = logging.getLogger("ampex.worker")


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
    log.info("worker %s klar — %s", VERSION, gpu_name())
    log.info("henter jobber fra %s", cfg.supabase_url)
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
    # Leses her og ikke i api.py: innmeldingen skal kunne testes uten en GPU,
    # og et kall som spør driveren selv er et kall som ikke lar seg teste.
    vram = vram_mb()
    compute = compute_capability()

    token = Api.enroll(args.url, args.anon, args.code,
                       socket.gethostname(), gpu_name(), VERSION,
                       vram_mb=vram, compute_capability=compute)
    NodeConfig(args.url, args.anon, token).save()

    # Skrives ut fordi det er DENNE avlesningen kontoret kommer til å vise, og
    # den som setter opp maskinen skal kunne se med en gang om driveren svarte.
    log.info("innmeldt som %s — %s, %s, compute %s — token lagret",
             socket.gethostname(), gpu_name(),
             f"{vram} MiB" if vram else "VRAM ukjent",
             compute or "ukjent")
    return 0


def cmd_bake(args) -> int:
    """Bak en mappe lokalt. Ingen kø, ingen R2, ingen innmelding.

    Finnes fordi «virker denne PC-en» og «er den meldt inn riktig» er to helt
    ulike spørsmål, og den som setter opp maskinen trenger å svare på det
    første alene — før noe som helst er koblet til firmaets kø.
    """
    frames = Path(args.frames)
    if not frames.is_dir():
        log.error("%s finnes ikke", frames)
        return 1
    cfg = BakeConfig()
    if args.atlas:
        cfg.atlas_size = args.atlas
    t0 = time.time()
    res = bake(frames, Path(args.ut), cfg,
               progress=lambda m, ms: log.info("  %s (%d ms)", m, ms))
    log.info("ferdig: %s — fylt %.1f%%, %.1f s",
             res.glb_path, res.filled_fraction * 100, time.time() - t0)
    return 0


def main() -> int:
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(prog="ampex-worker")
    sub = ap.add_subparsers(dest="cmd", required=True)

    e = sub.add_parser("enroll", help="meld inn denne PC-en i firmaets pool")
    e.add_argument("--url", default=DEFAULT_SUPABASE_URL,
                   help="Supabase-URL. Standard er Ampex sin.")
    e.add_argument("--anon", default=DEFAULT_ANON_KEY,
                   help="anon-nøkkel. Standard er Ampex sin (den er offentlig).")
    e.add_argument("--code", required=True, help="engangskode fra appen")
    e.set_defaults(fn=cmd_enroll)

    r = sub.add_parser("run", help="kjør bakes fra køen")
    r.set_defaults(fn=cmd_run)

    b = sub.add_parser("bake", help="bak en mappe lokalt (selvtest, ingen kø)")
    b.add_argument("frames", help="framesDir")
    b.add_argument("ut", nargs="?", default="ut.glb")
    b.add_argument("--atlas", type=int, default=None)
    b.set_defaults(fn=cmd_bake)

    args = ap.parse_args()
    log.info("plattform: %s", platform.platform())
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
