"""Leser framesDir slik iOS-skanneren skriver den.

Formatkontrakt (MeshScanPresenter.swift):
  frames.json      JSONEncoder([Keyframe]) — feltnavn = Swift-propertynavn
  frame-<i>.jpg    RGB-keyframe, nedskalert til (width, height)
  depth-<i>.f32    rå Float32 LiDAR-dybde i METER, tett depthWidth*depthHeight

Endrer skanneren formatet, er det HER det brekker — hold denne fila som den
eneste som kjenner layouten.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# ARKit-kamera: +X høyre, +Y opp, -Z fremover (OpenGL-stil).
# Open3D/OpenCV:  +X høyre, +Y ned, +Z fremover.
# Konverteringen er å snu Y og Z i KAMERA-aksene.
_ARKIT_TO_CV = np.diag([1.0, -1.0, -1.0, 1.0])


@dataclass
class Keyframe:
    index: int
    file: str
    timestamp: float
    width: int
    height: int
    transform: list[float]       # camera-to-world, 16 floats KOLONNE-major
    intrinsics: list[float]      # [fx, fy, cx, cy], skalert til (width, height)
    depth_file: str | None
    depth_width: int
    depth_height: int
    sharpness: float = 0.0
    motion: float = 0.0
    pre_lock: bool = False       # tatt før AE/AWB-låsen — annen eksponering
    is_plane_shot: bool = False  # dedikert veggfoto, fredet fra pruning

    @property
    def camera_to_world(self) -> np.ndarray:
        """4x4 i ARKit-konvensjon. Swift skriver KOLONNE-major."""
        return np.array(self.transform, dtype=np.float64).reshape(4, 4).T

    @property
    def extrinsic_cv(self) -> np.ndarray:
        """World-to-camera i OpenCV-konvensjon — det Open3D vil ha."""
        return _ARKIT_TO_CV @ np.linalg.inv(self.camera_to_world)

    def intrinsic_matrix(self) -> np.ndarray:
        fx, fy, cx, cy = self.intrinsics
        return np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], dtype=np.float64)

    def depth_intrinsic_matrix(self) -> np.ndarray:
        """Intrinsics skalert fra RGB-oppløsning til dybdekartets oppløsning."""
        sx = self.depth_width / self.width
        sy = self.depth_height / self.height
        fx, fy, cx, cy = self.intrinsics
        return np.array(
            [[fx * sx, 0, cx * sx], [0, fy * sy, cy * sy], [0, 0, 1]],
            dtype=np.float64,
        )

    @property
    def quality(self) -> float:
        """Samme ånd som scoreOf i MeshBakeV2: skarpt og rolig veier tyngst,
        og preLock straffes 0.6 slik baken på telefonen gjør."""
        q = self.sharpness / (1.0 + 2.0 * self.motion)
        return q * (0.6 if self.pre_lock else 1.0)


def _get(d: dict, *names, default=None):
    for n in names:
        if n in d and d[n] is not None:
            return d[n]
    return default


def load_manifest(frames_dir: Path) -> list[Keyframe]:
    raw = json.loads((frames_dir / "frames.json").read_text(encoding="utf-8"))
    out: list[Keyframe] = []
    for d in raw:
        out.append(
            Keyframe(
                index=d["index"],
                file=d["file"],
                timestamp=d.get("timestamp", 0.0),
                width=d["width"],
                height=d["height"],
                transform=d["transform"],
                intrinsics=d["intrinsics"],
                depth_file=_get(d, "depthFile", "depth_file"),
                depth_width=_get(d, "depthWidth", "depth_width", default=0),
                depth_height=_get(d, "depthHeight", "depth_height", default=0),
                sharpness=d.get("sharpness", 0.0),
                motion=d.get("motion", 0.0),
                pre_lock=bool(_get(d, "preLock", "pre_lock", default=False)),
                is_plane_shot=bool(_get(d, "isPlaneShot", "is_plane_shot", default=False)),
            )
        )
    out.sort(key=lambda k: k.index)
    return out


def load_depth(frames_dir: Path, kf: Keyframe) -> np.ndarray | None:
    """Float32 dybde i meter, formet (h, w). None når frame mangler dybde."""
    if not kf.depth_file:
        return None
    p = frames_dir / kf.depth_file
    if not p.exists():
        return None
    buf = np.fromfile(p, dtype="<f4")
    want = kf.depth_width * kf.depth_height
    if buf.size < want:
        return None
    return buf[:want].reshape(kf.depth_height, kf.depth_width)


def select_keyframes(kfs: list[Keyframe], budget: int | None) -> list[Keyframe]:
    """Poolen har ikke telefonens minnetak, så standard er Å BRUKE ALT.

    budget=None → alt. Ellers: planshots er fredet (som på telefonen), resten
    velges på kvalitet. Merk at dette IKKE er dekningsbevisst slik
    selectCoverageAware er — med fullt budsjett trengs det ikke.
    """
    if budget is None or len(kfs) <= budget:
        return kfs
    planes = [k for k in kfs if k.is_plane_shot]
    rest = sorted((k for k in kfs if not k.is_plane_shot),
                  key=lambda k: k.quality, reverse=True)
    keep = planes + rest[: max(budget - len(planes), 0)]
    keep.sort(key=lambda k: k.index)
    return keep
