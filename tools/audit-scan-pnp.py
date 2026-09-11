#!/usr/bin/env python3
"""Pairwise camera-pose diagnostic from feature matches and recorded source depth.
Reference pose remains fixed; no fixture metadata is modified. Holdout is never fitted.
"""
import json,sys
from pathlib import Path
import numpy as np
import cv2 as cv
root=Path(sys.argv[1]);frames=json.loads((root/'fixture-kf.json').read_text());pairs=json.loads(Path(sys.argv[2]).read_text())['pairs'];results=[];datasets=[]
flip=np.diag([1.,-1.,-1.,1.]);cv.setRNGSeed(31)
for pair in pairs:
 if 'source_points' not in pair:continue
 if pair.get('epipolar_held_median_px',float('inf'))>2 or pair.get('epipolar_held_under2px',0)<.75*pair['held_count']:continue
 r,t=frames[pair['reference']],frames[pair['target']];depth=np.fromfile(root/r['depthFile'],dtype='<f4').reshape(r['depthHeight'],r['depthWidth']);rt=np.array(r['transform']).reshape(4,4).T;tt=np.array(t['transform']).reshape(4,4).T
 fr=np.array(r['intrinsics'])*1600/r['width'];ft=np.array(t['intrinsics'])*1600/t['width'];k=np.array([[ft[0],0,ft[2]],[0,ft[1],ft[3]],[0,0,1.]])
 xyz=[];uv=[];held=[]
 for n,(u,v) in enumerate(pair['source_points']):
  ix=int(u/1600*r['depthWidth']);iy=int(v/(1600*r['height']/r['width'])*r['depthHeight'])
  if ix<1 or iy<1 or ix>=r['depthWidth']-1 or iy>=r['depthHeight']-1:continue
  patch=depth[iy-1:iy+2,ix-1:ix+2];z=float(depth[iy,ix])
  if not np.isfinite(patch).all() or z<.25 or np.ptp(patch)>.08:continue
  p=rt@np.array([(u-fr[2])/fr[0]*z,-(v-fr[3])/fr[1]*z,-z,1])
  xyz.append(p[:3]);uv.append(pair['target_points'][n]);held.append(pair['held'][n])
 xyz=np.array(xyz,dtype=np.float64);uv=np.array(uv,dtype=np.float64);held=np.array(held);train=~held
 if train.sum()<8 or held.sum()<3:continue
 prior=flip@np.linalg.inv(tt);r0=cv.Rodrigues(prior[:3,:3])[0];t0=prior[:3,3:4].copy()
 def errors(rv,tv):return np.linalg.norm(cv.projectPoints(xyz,rv,tv,k,None)[0][:,0,:]-uv,axis=1)
 datasets.append((pair["reference"],pair["target"],xyz,uv,held,k))
 before=errors(r0,t0)
 ok,rv,tv,inliers=cv.solvePnPRansac(xyz[train],uv[train],k,None,r0.copy(),t0.copy(),True,iterationsCount=1000,reprojectionError=5.,confidence=.999,flags=cv.SOLVEPNP_ITERATIVE)
 if not ok or inliers is None or len(inliers)<6:continue
 rv,tv=cv.solvePnPRefineLM(xyz[train][inliers[:,0]],uv[train][inliers[:,0]],k,None,rv,tv)
 after=errors(rv,tv);pose=np.eye(4);pose[:3,:3]=cv.Rodrigues(rv)[0];pose[:3,3]=tv[:,0];corrected=np.linalg.inv(flip@pose);delta=np.linalg.inv(tt)@corrected
 def stats(e):return {'median':float(np.median(e[held])),'p90':float(np.quantile(e[held],.9)),'under5':int(np.sum(e[held]<5))}
 results.append({'pair':[pair['reference'],pair['target']],'train':int(train.sum()),'inliers':len(inliers),'held':int(held.sum()),'before':stats(before),'after':stats(after),'translation_mm':float(np.linalg.norm(delta[:3,3])*1000),'rotation_deg':float(np.linalg.norm(cv.Rodrigues(delta[:3,:3])[0])*180/np.pi),'candidate_transform':corrected.T.ravel().tolist()})
for result in results:
 pose=flip@np.linalg.inv(np.array(result['candidate_transform']).reshape(4,4).T)
 rv=cv.Rodrigues(pose[:3,:3])[0];tv=pose[:3,3:4]
 cross=[]
 for reference,target,xyz,uv,held,k in datasets:
  if target!=result['pair'][1]:continue
  e=np.linalg.norm(cv.projectPoints(xyz,rv,tv,k,None)[0][:,0,:]-uv,axis=1)[held]
  cross.append({'reference':reference,'held':len(e),'median':float(np.median(e)),'p90':float(np.quantile(e,.9))})
 result['cross_reference_holdout']=cross
print(json.dumps(results,indent=2))
