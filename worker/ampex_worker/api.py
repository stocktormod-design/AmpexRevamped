"""Supabase-RPC og R2-I/O for worker-noden.

Node-tokenet ER autentiseringen (se migrasjonen
20260815120000_gpu_bake_worker_pool.sql). Worker-en bruker anon-nøkkelen og
holder ALDRI en brukersesjon eller R2-nøkler — blobbene nås kun via kortlevde
presignerte URL-er utstedt av en Edge Function.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "AmpexWorker"
CONFIG_FILE = CONFIG_DIR / "node.json"


@dataclass
class NodeConfig:
    supabase_url: str
    anon_key: str
    node_token: str

    @classmethod
    def load(cls) -> "NodeConfig | None":
        if not CONFIG_FILE.exists():
            return None
        d = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return cls(d["supabase_url"], d["anon_key"], d["node_token"])

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(self.__dict__), encoding="utf-8")
        # Tokenet er en hemmelighet — la den ikke ligge world-readable.
        try:
            os.chmod(CONFIG_FILE, 0o600)
        except OSError:
            pass


class Api:
    def __init__(self, cfg: NodeConfig, timeout: float = 60.0):
        self.cfg = cfg
        self._c = httpx.Client(
            base_url=cfg.supabase_url.rstrip("/"),
            timeout=timeout,
            headers={
                "apikey": cfg.anon_key,
                "Authorization": f"Bearer {cfg.anon_key}",
                "Content-Type": "application/json",
            },
        )

    def _rpc(self, fn: str, **params):
        r = self._c.post(f"/rest/v1/rpc/{fn}", json=params)
        r.raise_for_status()
        return r.json() if r.content else None

    # ── kø ──────────────────────────────────────────────────────────────────
    def claim(self, lease_seconds: int = 300):
        job = self._rpc("claim_scan_job",
                        node_token=self.cfg.node_token,
                        lease_seconds=lease_seconds)
        # Postgres returnerer composite som objekt, eller null når køen er tom.
        if isinstance(job, list):
            job = job[0] if job else None
        return job if job and job.get("id") else None

    def heartbeat(self, job_id: str, progress: float | None = None,
                  lease_seconds: int = 300) -> None:
        self._rpc("heartbeat_scan_job", node_token=self.cfg.node_token,
                  job_id=job_id, p_progress=progress, lease_seconds=lease_seconds)

    def complete(self, job_id: str, output_key: str, gpu_ms: int,
                 filled_fraction: float) -> None:
        self._rpc("complete_scan_job", node_token=self.cfg.node_token,
                  job_id=job_id, p_output_key=output_key,
                  p_gpu_ms=gpu_ms, p_filled_fraction=filled_fraction)

    def fail(self, job_id: str, error: str) -> None:
        self._rpc("fail_scan_job", node_token=self.cfg.node_token,
                  job_id=job_id, p_error=error[:2000])

    # ── innmelding ──────────────────────────────────────────────────────────
    @staticmethod
    def enroll(supabase_url: str, anon_key: str, code: str,
               hostname: str, gpu_name: str, version: str) -> str:
        with httpx.Client(base_url=supabase_url.rstrip("/"), timeout=60.0,
                          headers={"apikey": anon_key,
                                   "Authorization": f"Bearer {anon_key}",
                                   "Content-Type": "application/json"}) as c:
            r = c.post("/rest/v1/rpc/enroll_worker_node", json={
                "enrollment_code": code,
                "p_hostname": hostname,
                "p_gpu_name": gpu_name,
                "p_worker_version": version,
            })
            r.raise_for_status()
            return r.json()

    # ── R2 via presignerte URL-er ───────────────────────────────────────────
    def presign(self, job_id: str, action: str, name: str | None = None) -> dict:
        """Edge Function 'scan-blobs' bytter node-token mot kortlevde URL-er.

        Worker-en har to grener der, og de er bevisst atskilte:
          'download'  GET-URL-er for hele input_prefix
          'output'    én PUT-URL for resultatet, under et ANNET prefiks

        Skillet er ikke kosmetisk: uten det kan en node skrive over rammene den
        nettopp lastet ned, og da kan en mislykket bake ikke kjøres om.
        Telefonens 'upload'/'finish' krever brukersesjon og nås ikke herfra.
        """
        body: dict = {
            "node_token": self.cfg.node_token,
            "job_id": job_id,
            "action": action,
        }
        if name is not None:
            body["files"] = [{"name": name}]
        r = self._c.post("/functions/v1/scan-blobs", json=body)
        r.raise_for_status()
        return r.json()

    def download_frames(self, job_id: str, dest: Path) -> Path:
        dest.mkdir(parents=True, exist_ok=True)
        manifest = self.presign(job_id, "download")
        for item in manifest["files"]:
            out = dest / item["name"]
            out.parent.mkdir(parents=True, exist_ok=True)
            with self._c.stream("GET", item["url"]) as resp:
                resp.raise_for_status()
                with out.open("wb") as fh:
                    for chunk in resp.iter_bytes(1 << 20):
                        fh.write(chunk)
        return dest

    def upload_glb(self, job_id: str, glb: Path) -> str:
        info = self.presign(job_id, "output", name=glb.name)
        with glb.open("rb") as fh:
            r = httpx.put(info["url"], content=fh.read(), timeout=600.0,
                          headers={"Content-Type": "model/gltf-binary"})
            r.raise_for_status()
        return info["key"]
