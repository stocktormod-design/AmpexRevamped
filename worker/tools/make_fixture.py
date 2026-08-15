"""Lager en syntetisk framesDir i nøyaktig samme format som iOS-skanneren.

Formål: verifisere at worker-pipelinen kjører ende-til-ende — særlig
pose-konvensjonen (ARKit camera-to-world, kolonne-major → OpenCV extrinsic).
Et rom med kjent geometri gir en fasit: går fusjonen galt, kollapser meshen.

    python tools/make_fixture.py <utmappe> [--frames 24]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import open3d as o3d
from PIL import Image

W, H = 640, 480          # RGB-oppløsning
DW, DH = 256, 192        # dybdeoppløsning, som ARKit
ROOM = (4.0, 2.6, 5.0)   # bredde, høyde, dybde i meter


def room_mesh() -> o3d.t.geometry.TriangleMesh:
    """Innsiden av en boks: normaler inn, farge per vegg så teksturen er lesbar."""
    w, h, d = ROOM
    box = o3d.geometry.TriangleMesh.create_box(w, h, d)
    box.translate((-w / 2, 0.0, -d / 2))
    box.compute_vertex_normals()
    v = np.asarray(box.vertices)
    # Farg vertekser etter dominant akse — gir vegger/gulv/tak ulik tone.
    col = np.zeros_like(v)
    for ax in range(3):
        col[:, ax] = (v[:, ax] - v[:, ax].min()) / max(float(np.ptp(v[:, ax])), 1e-6)
    box.vertex_colors = o3d.utility.Vector3dVector(np.clip(col * 0.8 + 0.15, 0, 1))
    return box


def look_at_arkit(eye, target, up=(0, 1, 0)) -> np.ndarray:
    """4x4 camera-to-world i ARKit-konvensjon: +X høyre, +Y opp, -Z fremover."""
    eye = np.asarray(eye, float)
    fwd = np.asarray(target, float) - eye
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, np.asarray(up, float))
    right /= np.linalg.norm(right)
    true_up = np.cross(right, fwd)
    M = np.eye(4)
    M[:3, 0] = right
    M[:3, 1] = true_up
    M[:3, 2] = -fwd          # ARKit ser langs -Z
    M[:3, 3] = eye
    return M


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out", type=Path)
    ap.add_argument("--frames", type=int, default=24)
    args = ap.parse_args()

    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    mesh = room_mesh()
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))

    fx = fy = 0.9 * W
    cx, cy = W / 2, H / 2
    sx, sy = DW / W, DH / H

    manifest = []
    for i in range(args.frames):
        # Kameraet står midt i rommet og snurrer — som en feiing på stedet.
        ang = 2 * np.pi * i / args.frames
        eye = np.array([0.6 * np.cos(ang * 0.5), 1.5, 0.6 * np.sin(ang * 0.5)])
        target = eye + np.array([np.cos(ang), -0.15, np.sin(ang)])
        c2w = look_at_arkit(eye, target)

        rays = scene.create_rays_pinhole(
            intrinsic_matrix=o3d.core.Tensor(
                [[fx * sx, 0, cx * sx], [0, fy * sy, cy * sy], [0, 0, 1]],
                dtype=o3d.core.Dtype.Float64),
            # create_rays_pinhole vil ha world-to-camera i OpenCV-konvensjon
            extrinsic_matrix=o3d.core.Tensor(
                np.diag([1.0, -1.0, -1.0, 1.0]) @ np.linalg.inv(c2w),
                dtype=o3d.core.Dtype.Float64),
            width_px=DW, height_px=DH)
        ans = scene.cast_rays(rays)

        depth = ans["t_hit"].numpy().astype(np.float32)
        depth[~np.isfinite(depth)] = 0.0

        # Enkel «RGB»: kod dybde + treffnormal til en lesbar farge. Nok til at
        # teksturbaken har noe å projisere, og til å se om atlaset fylles.
        nrm = ans["primitive_normals"].numpy()
        shade = np.clip(0.35 + 0.65 * np.abs(nrm), 0, 1)
        rgb_small = (shade * 255).astype(np.uint8)
        rgb = np.array(Image.fromarray(rgb_small).resize((W, H), Image.NEAREST))

        Image.fromarray(rgb).save(out / f"frame-{i}.jpg", quality=92)
        depth.astype("<f4").tofile(out / f"depth-{i}.f32")

        manifest.append({
            "index": i,
            "file": f"frame-{i}.jpg",
            "timestamp": float(i) * 0.1,
            "width": W,
            "height": H,
            # Swift skriver KOLONNE-major → transponer før flatning.
            "transform": [float(x) for x in c2w.T.flatten()],
            "intrinsics": [fx, fy, cx, cy],
            "depthFile": f"depth-{i}.f32",
            "depthWidth": DW,
            "depthHeight": DH,
            "sharpness": 1.0,
            "motion": 0.0,
            "preLock": False,
            "isPlaneShot": False,
        })

    (out / "frames.json").write_text(json.dumps(manifest), encoding="utf-8")
    print(f"skrev {args.frames} frames til {out}")


if __name__ == "__main__":
    main()
