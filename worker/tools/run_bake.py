"""Kjør én bake lokalt mot en framesDir — uten kø, uten R2.

Dette er regresjonsselen: samme framesDir gjennom telefon-baken og denne, så
sammenlign filledFraction. («Kvalitet itereres på FIXTURES, ikke knotter.»)

    python tools/run_bake.py <framesDir> <ut.glb> [--atlas 8192] [--keyframes N]
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ampex_worker.bake import BakeConfig, bake  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames_dir", type=Path)
    ap.add_argument("out_glb", type=Path)
    ap.add_argument("--atlas", type=int, default=8192)
    ap.add_argument("--keyframes", type=int, default=None,
                    help="tak på antall keyframes (standard: bruk alle)")
    ap.add_argument("--triangles", type=int, default=300_000)
    ap.add_argument("--iterations", type=int, default=30)
    ap.add_argument("--rigid", action="store_true",
                    help="rigid pose-refine som på telefonen")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    cfg = BakeConfig(
        atlas_size=args.atlas,
        keyframe_budget=args.keyframes,
        target_triangles=args.triangles,
        refine_iterations=args.iterations,
        non_rigid=not args.rigid,
    )
    r = bake(args.frames_dir, args.out_glb, cfg)

    print("---- RESULTAT ----")
    print(f"glb            : {r.glb_path} ({r.glb_path.stat().st_size} bytes)")
    print(f"filledFraction : {r.filled_fraction:.4f}")
    print(f"trekanter      : {r.triangles}")
    print(f"keyframes      : {r.keyframes_used}")
    print(f"tid            : {r.ms} ms")
    print(f"faser          : {r.stages}")


if __name__ == "__main__":
    main()
