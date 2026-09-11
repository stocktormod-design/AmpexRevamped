#!/usr/bin/env python3
"""Leave a selected image neighborhood out of fitting; compare image-field models.
Diagnostic only. Other views of the same surface may still be correlated.
"""
import json,sys
from pathlib import Path
import numpy as np
source,fixture=sys.argv[1:3];focus=int(sys.argv[3]);point=np.array([*map(float,sys.argv[4:7]),1]);radius=float(sys.argv[7])
d=json.loads(Path(source).read_text());kf=json.loads(Path(fixture).read_text());rows=d['matches'];n=len(d['frames'])
assert n==len(kf),'Filtered fixtures need an explicit frame ID map'
f=kf[focus];c=np.linalg.inv(np.array(f['transform']).reshape(4,4).T)@point
fx,fy,cx,cy=f['intrinsics'];uv=np.array([fx*c[0]/-c[2]+cx,-fy*c[1]/-c[2]+cy])*d['frames'][focus]['width']/f['width']
local=np.array([any(r[s.lower()]==focus and np.linalg.norm(np.array(r['uv'+s])-uv)<radius for s in ['R','T']) for r in rows])
held=np.array([r['held'] for r in rows]);train=~(held|local)
y=np.array([r['shift'] for r in rows]);native=np.array([r['residual'] for r in rows])
def stats(e,mask):
 v=np.abs(e[mask]);return {'count':len(v),'median':float(np.median(v)) if len(v) else None,'p90':float(np.quantile(v,.9)) if len(v) else None}
report={'focus_frame':focus,'uv':uv.tolist(),'radius':radius,'native_local':stats(native,local),'models':{}}
for model,features in [('translation',1),('affine',3)]:
 a=np.zeros((len(rows),n*2*features))
 for k,r in enumerate(rows):
  for side in ['R','T']:
   i=r[side.lower()];coeff=np.array(r['c'+side.lower()]);f=d['frames'][i];q=r['uv'+side]
   basis=np.array([1,q[0]/f['width']-.5,q[1]/f['height']-.5])[:features]
   a[k,i*2*features:(i+1)*2*features]+=np.outer(coeff,basis).ravel()
 anchor=d['anchor'];a[:,anchor*2*features:(anchor+1)*2*features]=0
 for ridge in [1.,10.]:
  at=a[train];yt=y[train];fit=np.zeros(a.shape[1])
  for _ in range(12):
   w=np.minimum(1,1.5/np.maximum(abs(at@fit-yt),1e-6))
   fit=np.linalg.solve(at.T@(at*w[:,None])+np.eye(a.shape[1])*ridge,at.T@(w*yt))
  error=a@fit-y
  report['models'][model+'_'+str(ridge)]={'local_excluded':stats(error,local),'other_held':stats(error,held&~local),'max_coefficient':float(abs(fit).max())}
print(json.dumps(report,indent=2))
