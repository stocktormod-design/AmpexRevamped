"""Bake-pipelinen på PC.

Samme rekkefølge som MeshBakeV2.swift, men uten telefonens budsjetter:
  TSDF-fusjon → pose-refine (Zhou-Koltun) → forenkling → xatlas → teksturbake → GLB

Budsjettene ER poenget med å flytte jobben hit — se BakeConfig.

MERK om GPU: Open3D-hjulet fra pip er CPU-only på Windows (o3d.core.cuda
.device_count() == 0). Fusjon, refine og teksturprojeksjon kjører altså på CPU
inntil Open3D bygges med CUDA. Det er fortsatt langt utenfor telefonens
termiske budsjett, men det er ikke GPU-akselerert ennå.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import open3d as o3d
from PIL import Image

from .frames import Keyframe, load_depth, load_manifest, select_keyframes

log = logging.getLogger(__name__)


@dataclass
class BakeConfig:
    """Telefonens verdier står i kommentar — se docs/GPU_BAKE_PLAN.md."""
    keyframe_budget: int | None = None   # telefon: 96-120. None = bruk ALT.
    atlas_size: int = 8192               # telefon: 8192 (4096 under 6 GB)
    voxel_size: float = 0.02             # TSDF-oppløsning i meter
    sdf_trunc: float = 0.06
    depth_max: float = 5.0               # LiDAR-rekkevidde
    target_triangles: int = 300_000
    refine_iterations: int = 30          # telefon: 8
    non_rigid: bool = True               # telefon: rigid (bevisst utelatt)
    texture_max_width: int = 2048        # nedskalering før albedo-projeksjon


@dataclass
class BakeResult:
    glb_path: Path
    filled_fraction: float
    ms: int
    keyframes_used: int
    triangles: int
    stages: dict = field(default_factory=dict)


def _prepare(frames_dir: Path, kfs: list[Keyframe], cfg: BakeConfig):
    """(rgbd, intrinsic, extrinsic, rgb_full, K_full, kf) per brukbar keyframe."""
    out = []
    for kf in kfs:
        depth = load_depth(frames_dir, kf)
        if depth is None:
            continue
        try:
            rgb = Image.open(frames_dir / kf.file).convert("RGB")
        except OSError:
            log.warning("kunne ikke lese %s", kf.file)
            continue

        dw, dh = kf.depth_width, kf.depth_height
        rgb_small = np.asarray(rgb.resize((dw, dh), Image.BILINEAR), dtype=np.uint8)

        d = np.where(np.isfinite(depth), depth, 0.0).astype(np.float32)
        d[d > cfg.depth_max] = 0.0

        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(np.ascontiguousarray(rgb_small)),
            o3d.geometry.Image(d),
            depth_scale=1.0,           # dybden er allerede i meter
            depth_trunc=cfg.depth_max,
            convert_rgb_to_intensity=False,
        )
        Kd = kf.depth_intrinsic_matrix()
        intr = o3d.camera.PinholeCameraIntrinsic(
            dw, dh, Kd[0, 0], Kd[1, 1], Kd[0, 2], Kd[1, 2]
        )

        # Teksturen fortjener mer enn dybdeoppløsningen; skaler ned kun ved behov.
        scale = min(1.0, cfg.texture_max_width / kf.width)
        tw, th = max(1, int(kf.width * scale)), max(1, int(kf.height * scale))
        rgb_tex = np.asarray(rgb.resize((tw, th), Image.LANCZOS), dtype=np.uint8)
        K_full = kf.intrinsic_matrix().copy()
        K_full[:2, :] *= scale

        out.append((rgbd, intr, kf.extrinsic_cv, np.ascontiguousarray(rgb_tex), K_full, kf))
    return out


def _fuse(items, cfg: BakeConfig) -> o3d.geometry.TriangleMesh:
    vol = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=cfg.voxel_size,
        sdf_trunc=cfg.sdf_trunc,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
    )
    for rgbd, intr, extr, *_ in items:
        vol.integrate(rgbd, intr, extr)
    mesh = vol.extract_triangle_mesh()
    mesh.compute_vertex_normals()
    return mesh


def _refine_poses(mesh, items, cfg: BakeConfig):
    """Zhou-Koltun — samme metode som MeshPoseRefineV2, men flere iterasjoner
    og (når non_rigid) den varianten telefonen bevisst utelater."""
    traj = o3d.camera.PinholeCameraTrajectory()
    params = []
    for _, intr, extr, *_ in items:
        p = o3d.camera.PinholeCameraParameters()
        p.intrinsic = intr
        p.extrinsic = extr
        params.append(p)
    traj.parameters = params

    rgbd_list = [it[0] for it in items]
    if cfg.non_rigid:
        option = o3d.pipelines.color_map.NonRigidOptimizerOption(
            maximum_iteration=cfg.refine_iterations)
        mesh_out, traj_out = o3d.pipelines.color_map.run_non_rigid_optimizer(
            mesh, rgbd_list, traj, option)
    else:
        option = o3d.pipelines.color_map.RigidOptimizerOption(
            maximum_iteration=cfg.refine_iterations)
        mesh_out, traj_out = o3d.pipelines.color_map.run_rigid_optimizer(
            mesh, rgbd_list, traj, option)
    return mesh_out, [p.extrinsic for p in traj_out.parameters]


def _texture(mesh, items, cfg: BakeConfig):
    """UV-atlas + multi-view albedo. Open3D pakker xatlas selv, så dette er
    samme unwrapper som er vendret i iOS-modulen."""
    tm = o3d.t.geometry.TriangleMesh.from_legacy(mesh)
    tm.compute_uvatlas(size=cfg.atlas_size)

    images = [o3d.t.geometry.Image(o3d.core.Tensor(it[3])) for it in items]
    Ks = [o3d.core.Tensor(it[4], dtype=o3d.core.Dtype.Float32) for it in items]
    Ts = [o3d.core.Tensor(np.ascontiguousarray(it[2]), dtype=o3d.core.Dtype.Float32)
          for it in items]

    tm.project_images_to_albedo(images, Ks, Ts, tex_size=cfg.atlas_size)

    albedo = tm.material.texture_maps["albedo"].as_tensor().numpy()
    # Fyllgrad = andel texels som faktisk fikk farge. Samme mål som
    # filledFraction i MeshScanResult, så tallene kan sammenlignes direkte.
    filled = float((albedo.reshape(-1, albedo.shape[-1]).sum(axis=1) > 0).mean())
    return tm, filled


def bake(frames_dir: Path, out_glb: Path, cfg: BakeConfig | None = None,
         progress=None) -> BakeResult:
    cfg = cfg or BakeConfig()
    t0 = time.time()
    stages: dict[str, int] = {}

    def tick(name, msg):
        stages[name] = int((time.time() - t0) * 1000)
        log.info("%s (%d ms)", msg, stages[name])
        if progress:
            progress(msg, stages[name])

    kfs = select_keyframes(load_manifest(frames_dir), cfg.keyframe_budget)
    if not kfs:
        raise ValueError("ingen keyframes i frames.json")

    items = _prepare(frames_dir, kfs, cfg)
    if not items:
        raise ValueError("ingen keyframes med gyldig dybde")
    tick("load", f"Leste {len(items)} keyframes")

    mesh = _fuse(items, cfg)
    if len(mesh.triangles) == 0:
        raise ValueError("TSDF ga tom mesh — sjekk pose-konvensjon og dybdeenhet")
    tick("fuse", f"TSDF-fusjon: {len(mesh.triangles)} trekanter")

    try:
        mesh, refined = _refine_poses(mesh, items, cfg)
        items = [(r, i, e, t, k, kf) for (r, i, _, t, k, kf), e in zip(items, refined)]
        tick("refine", "Pose-refine ferdig")
    except Exception as exc:  # noqa: BLE001 — refine forbedrer, men er ikke et krav
        log.warning("pose-refine hoppet over: %s", exc)

    if len(mesh.triangles) > cfg.target_triangles:
        mesh = mesh.simplify_quadric_decimation(cfg.target_triangles)
        mesh.compute_vertex_normals()
    tick("simplify", f"Forenklet til {len(mesh.triangles)} trekanter")

    tm, filled = _texture(mesh, items, cfg)
    tick("texture", f"Tekstur bakt — fylt {filled * 100:.1f}%")

    out_glb.parent.mkdir(parents=True, exist_ok=True)
    o3d.t.io.write_triangle_mesh(str(out_glb), tm)
    tick("glb", f"Skrev {out_glb.name}")

    return BakeResult(
        glb_path=out_glb,
        filled_fraction=filled,
        ms=int((time.time() - t0) * 1000),
        keyframes_used=len(items),
        triangles=int(len(mesh.triangles)),
        stages=stages,
    )
