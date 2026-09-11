# Lager en dense.jsonl + dense-*.f32-lenker fra en fixtures keyframe-dybdekart,
# så TSDF-veien (produksjonens rebake) kan kjøres på et HELT ROM uten ny skanning.
import json, os, sys, pathlib
src = pathlib.Path(sys.argv[1]); dst = pathlib.Path(sys.argv[2])
dst.mkdir(parents=True, exist_ok=True)
for p in src.iterdir():
    q = dst / p.name
    if not q.exists():
        try: q.symlink_to(p)
        except FileExistsError: pass
kf = json.load(open(src / "fixture-kf.json"))
rows, n = [], 0
for k in kf:
    dw, dh = k.get("depthWidth"), k.get("depthHeight")
    df = k.get("depthFile")
    if not (dw and dh and df and (src / df).exists()): continue
    fx, fy, cx, cy = k["intrinsics"]
    sx, sy = dw / k["width"], dh / k["height"]
    rows.append(json.dumps({"i": k["index"], "t": k["timestamp"], "w": dw, "h": dh,
                            "fx": fx*sx, "fy": fy*sy, "cx": cx*sx, "cy": cy*sy,
                            "m": [float(v) for v in k["transform"]]}))
    lenke = dst / f"dense-{k['index']}.f32"
    if not lenke.exists():
        lenke.symlink_to(src / df)
    n += 1
(dst / "dense.jsonl").write_text("\n".join(rows) + "\n")
print(f"{n} dybdekart → {dst}")
