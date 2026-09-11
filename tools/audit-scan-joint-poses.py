#!/usr/bin/env python3
"""Small joint-pose diagnostic. Fixed source depth, paired holdout, per-component anchor.
No original files are modified. Uses finite-difference robust least squares, not a live backend.
"""
import sys,json,os
from pathlib import Path
import numpy as np
import cv2 as cv
translation_limit=float(os.environ.get('AMPEX_POSE_LIMIT_M','.05'))
root=Path(sys.argv[1]);frames=json.loads((root/'fixture-kf.json').read_text());edges=[];seen=set();depths={}
def depth_point(i,uv):
 f=frames[i]
 if i not in depths:depths[i]=np.fromfile(root/f['depthFile'],dtype='<f4').reshape(f['depthHeight'],f['depthWidth'])
 d=depths[i];u,v=uv;ix=int(u/1600*f['depthWidth']);iy=int(v/(1600*f['height']/f['width'])*f['depthHeight'])
 if not 1<=ix<d.shape[1]-1 or not 1<=iy<d.shape[0]-1:return None
 patch=d[iy-1:iy+2,ix-1:ix+2];z=float(d[iy,ix])
 if not np.isfinite(patch).all() or z<.25 or np.ptp(patch)>.08:return None
 fx,fy,cx,cy=np.array(f['intrinsics'])*1600/f['width']
 return [(u-cx)/fx*z,-(v-cy)/fy*z,-z]
for file in sys.argv[2:]:
 for p in json.loads(Path(file).read_text())['pairs']:
  key=tuple(sorted([p['reference'],p['target']]))
  if key in seen or 'source_points' not in p:continue
  if p.get('epipolar_held_median_px',1e9)>2 or p.get('epipolar_held_under2px',0)<.75*p['held_count']:continue
  seen.add(key)
  for reverse in [False,True]:
   r,t=(p['target'],p['reference']) if reverse else (p['reference'],p['target'])
   src,dst=(p['target_points'],p['source_points']) if reverse else (p['source_points'],p['target_points'])
   xyz=[];uv=[];held=[]
   for a,b,h in zip(src,dst,p['held']):
    q=depth_point(r,a)
    if q is not None:xyz.append(q);uv.append(b);held.append(h)
   if len(xyz)>=8:edges.append((r,t,np.array(xyz),np.array(uv),np.array(held)))
nodes=sorted({i for e in edges for i in e[:2]});graph={i:set() for i in nodes}
for r,t,*_ in edges:graph[r].add(t);graph[t].add(r)
remaining=set(nodes);anchors=[]
while remaining:
 anchor=min(remaining);anchors.append(anchor);todo=[anchor]
 while todo:
  i=todo.pop()
  if i not in remaining:continue
  remaining.remove(i);todo.extend(graph[i]&remaining)
free=[i for i in nodes if i not in anchors];original={i:np.array(frames[i]['transform']).reshape(4,4).T for i in nodes}
def poses(x):
 result={i:p.copy() for i,p in original.items()}
 for k,i in enumerate(free):
  result[i][:3,:3]=original[i][:3,:3]@cv.Rodrigues(x[k*6:k*6+3])[0]
  result[i][:3,3]+=x[k*6+3:k*6+6]
 return result
def errors(x,training):
 p=poses(x);values=[]
 for r,t,xyz,uv,held in edges:
  mask=~held if training else held
  world=xyz[mask]@p[r][:3,:3].T+p[r][:3,3];cam=(world-p[t][:3,3])@p[t][:3,:3]
  fx,fy,cx,cy=np.array(frames[t]['intrinsics'])*1600/frames[t]['width']
  projected=np.column_stack([fx*cam[:,0]/-cam[:,2]+cx,-fy*cam[:,1]/-cam[:,2]+cy])
  values.append((projected-uv[mask]).ravel())
 return np.concatenate(values)
def prior(x):return x/np.tile([.03,.03,.03,.03,.03,.03],len(free))
def objective(x):
 e=np.abs(errors(x,True));return float(np.sum(np.where(e<3,.5*e*e,3*(e-1.5)))+.5*np.sum(prior(x)**2))
x=np.zeros(len(free)*6);initial=objective(x)
for _ in range(15):
 e=errors(x,True);w=np.minimum(1,3/np.maximum(abs(e),1e-9));j=np.empty((len(e),len(x)))
 for k in range(len(x)):
  y=x.copy();y[k]+=1e-5;j[:,k]=(errors(y,True)-e)/1e-5
 h=j.T@(w[:,None]*j)+np.eye(len(x))*(1/.03**2+1e-3);b=j.T@(w*e)+x/.03**2
 step=-np.linalg.solve(h,b);old=objective(x);accepted=False
 for scale in [1.,.5,.25,.125,.0625]:
  candidate=x+step*scale;blocks=candidate.reshape(-1,6)
  if np.max(np.linalg.norm(blocks[:,:3],axis=1))>np.deg2rad(3) or np.max(np.linalg.norm(blocks[:,3:],axis=1))>translation_limit:continue
  if objective(candidate)<old:x=candidate;accepted=True;break
 if not accepted or np.linalg.norm(step*scale)<1e-6:break
report={'translation_limit_m':translation_limit,'nodes':nodes,'anchors':anchors,'training_objective':[initial,objective(x)],'pairs':[],'candidate_transforms':{str(i):p.T.ravel().tolist() for i,p in poses(x).items()}}
offset=0;before=errors(np.zeros_like(x),False);after=errors(x,False)
for r,t,xyz,uv,held in edges:
 count=int(held.sum());a=np.linalg.norm(before[offset:offset+count*2].reshape(-1,2),axis=1);b=np.linalg.norm(after[offset:offset+count*2].reshape(-1,2),axis=1);offset+=count*2
 report['pairs'].append({'pair':[r,t],'held':count,'before_median':float(np.median(a)) if count else None,'after_median':float(np.median(b)) if count else None,'before_p90':float(np.quantile(a,.9)) if count else None,'after_p90':float(np.quantile(b,.9)) if count else None})
print(json.dumps(report,indent=2))
