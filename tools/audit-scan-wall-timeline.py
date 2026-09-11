#!/usr/bin/env python3
"""Measure fixed-normal wall offsets in raw depth, without editing camera poses.
Usage: script fixture-directory wall-ray-grid.json reference-frame-index
Grid must describe one visually checked planar wall. This cannot distinguish
pose drift from depth bias, or constrain motion parallel to the wall.
"""
import json, sys
from pathlib import Path
import numpy as np
root=Path(sys.argv[1]); samples=json.loads(Path(sys.argv[2]).read_text())
points=np.array([r['point'] for r in samples]); center=points.mean(axis=0)
normal=np.mean([r['normal'] for r in samples],axis=0);normal/=np.linalg.norm(normal)
u=np.cross(normal,[0.,1.,0.]);u/=np.linalg.norm(u);v=np.cross(normal,u)
coords=np.column_stack([(points-center)@u,(points-center)@v])
x,y=np.meshgrid(np.linspace(coords[:,0].min(),coords[:,0].max(),17),np.linspace(coords[:,1].min(),coords[:,1].max(),17))
wall=center+x.ravel()[:,None]*u+y.ravel()[:,None]*v
gx,gy=np.meshgrid(np.arange(17),np.arange(17));held=((gx+gy)%2==0).ravel()
def measure(kind,index,time,path,w,h,k,transform):
    m=np.array(transform).reshape(4,4).T; c=np.column_stack([wall,np.ones(len(wall))])@np.linalg.inv(m).T
    z=-c[:,2];fx,fy,cx,cy=k
    px=fx*c[:,0]/z+cx;py=-fy*c[:,1]/z+cy
    valid=(z>.25)&(px>=1)&(py>=1)&(px<w-1)&(py<h-1)
    ix=np.clip(px.astype(int),1,w-2);iy=np.clip(py.astype(int),1,h-2)
    d=np.fromfile(root/path,dtype='<f4').reshape(h,w)
    depth=d[iy,ix].astype(float)
    patch=np.stack([d[iy+dy,ix+dx] for dy in [-1,0,1] for dx in [-1,0,1]])
    valid &= np.isfinite(patch).all(axis=0)&(patch.min(axis=0)>.25)&(np.ptp(patch,axis=0)<.04)&(np.abs(depth-z)<.15)
    # Use sampled pixel centers for depth unprojection, not projected subpixel UV.
    local=np.column_stack([((ix+.5)-cx)/fx*depth,-((iy+.5)-cy)/fy*depth,-depth,np.ones(len(depth))])
    world=(local@m.T)[:,:3];offset=(world-center)@normal
    train=valid&~held;test=valid&held
    row={'kind':kind,'index':index,'time':time,'train':int(train.sum()),'held':int(test.sum()),'coverage':float(valid.mean())}
    if train.sum()<30 or test.sum()<30:return row
    estimate=float(np.median(offset[train])); residual=offset[test]-estimate
    row.update(offset_m=estimate,held_median_abs_mm=float(np.median(np.abs(residual))*1000),held_p90_abs_mm=float(np.percentile(np.abs(residual),90)*1000),held_signed_mm=float(np.median(residual)*1000))
    # Fit only the three observable plane parameters. No six-DOF pose claim.
    design=np.column_stack([(world-center)@u,(world-center)@v,np.ones(len(world))])
    selected=train.copy()
    for _ in range(4):
        coefficients=np.linalg.lstsq(design[selected],offset[selected],rcond=None)[0]
        error=offset-design@coefficients
        scale=max(.002,1.4826*np.median(np.abs(error[selected]-np.median(error[selected]))))
        selected=train&(np.abs(error)<3*scale)
        if selected.sum()<20:break
    plane_normal=normal-coefficients[0]*u-coefficients[1]*v
    length=np.linalg.norm(plane_normal);plane_normal/=length
    row.update(plane_normal=plane_normal.tolist(),plane_offset_m=float(np.dot(plane_normal,center)+coefficients[2]/length),
               plane_held_p90_mm=float(np.percentile(np.abs((offset-design@coefficients)[test])/length,90)*1000))
    for label,mask in [('left',gx.ravel()<8),('right',gx.ravel()>8)]:
        use=valid&mask
        row[label+'_offset_m']=float(np.median(offset[use])) if use.sum()>=20 else None
    return row
rows=[]
for f in json.loads((root/'fixture-kf.json').read_text()):
    sx=f['depthWidth']/f['width'];sy=f['depthHeight']/f['height'];fx,fy,cx,cy=f['intrinsics']
    rows.append(measure('keyframe',f['index'],f['timestamp'],f['depthFile'],f['depthWidth'],f['depthHeight'],[fx*sx,fy*sy,cx*sx,cy*sy],f['transform']))
for line in (root/'dense.jsonl').read_text().splitlines():
    f=json.loads(line);rows.append(measure('dense',f['i'],f['t'],f"dense-{f['i']}.f32",f['w'],f['h'],[f[k] for k in ['fx','fy','cx','cy']],f['m']))
ref=next(r for r in rows if r['kind']=='keyframe' and r['index']==int(sys.argv[3]))
assert 'offset_m' in ref, 'Reference has insufficient wall support'
for row in rows:
    if 'offset_m' in row:
        row['normal_translation_proposal_m']=ref['offset_m']-row['offset_m']
print(json.dumps({'normal':normal.tolist(),'center':center.tolist(),'reference':int(sys.argv[3]),'rows':sorted(rows,key=lambda r:r['time'])},indent=2,allow_nan=False))
