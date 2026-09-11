#!/usr/bin/env python3
"""Experimental image-offset graph from audit-scan-reprojection.py JSON reports.
Usage: python3 tools/solve-scan-edge-offsets.py OUTPUT_JSON AUDIT_JSON ...
Fits constant 2D image offsets, not physical camera calibration. Anchor: frame 5.
"""
import json,sys
from pathlib import Path
import numpy as np
reports=[json.loads(Path(p).read_text()) for p in sys.argv[2:]]
ids=sorted({r['reference'] for r in reports}|{f['frame'] for r in reports for f in r['frames']})
slot={f:2*i for i,f in enumerate(ids)}; rows=[];rhs=[]; held=[]
for report in reports:
 ref=report['reference']
 for target in report['frames']:
  if target['frame']==ref or target['count']<5:continue
  for mi,m in enumerate(target['matches']):
   n=np.array(m['normal']);j=np.array(m['jacobian']);row=np.zeros(2*len(ids))
   row[slot[target['frame']]:slot[target['frame']]+2]=n
   row[slot[ref]:slot[ref]+2]=-n@j
   if mi%2:held.append((row,m['normal_shift']))
   else:rows.append(row);rhs.append(m['normal_shift'])
a=np.array(rows);b=np.array(rhs);anchor=np.zeros((2,len(ids)*2));anchor[:,slot[5]:slot[5]+2]=np.eye(2)*100
# Straight parallel edges cannot determine motion along the edge. Only retain
# directions supported by the observation matrix; do not invent a large tangent shift.
columns=[];ranks={}
for f in ids:
 block=a[:,slot[f]:slot[f]+2];ev,vec=np.linalg.eigh(block.T@block)
 rank=0
 for k in range(2):
  if ev[k] <= max(1e-6,ev[-1]*.1):continue
  col=np.zeros(len(ids)*2);col[slot[f]:slot[f]+2]=vec[:,k];columns.append(col);rank+=1
 ranks[str(f)]=rank
projection=np.column_stack(columns)
x=np.zeros(len(ids)*2)
for _ in range(12):
 residual=a@x-b;weights=np.sqrt(np.minimum(1,1.5/np.maximum(abs(residual),1e-9)))
 matrix=np.vstack([a*weights[:,None],anchor,np.eye(len(x))*.02])
 target=np.r_[b*weights,np.zeros(2+len(x))]
 x=projection@np.linalg.lstsq(matrix@projection,target,rcond=None)[0]
ha=np.array([v[0] for v in held]);hb=np.array([v[1] for v in held]);err=ha@x-hb
summary={'training':len(b),'heldout':len(hb),'heldout_median_abs_before':float(np.median(abs(hb))), 'heldout_median_abs_after':float(np.median(abs(err))), 'heldout_p90_before':float(np.percentile(abs(hb),90)), 'heldout_p90_after':float(np.percentile(abs(err),90))}
result={'width':960,'anchor':5,'validation':summary,'observable_dimensions':ranks,'offsets':{str(f):x[slot[f]:slot[f]+2].tolist() for f in ids}}
assert np.isfinite(x).all()
assert np.linalg.norm(x[slot[5]:slot[5]+2])<.01
Path(sys.argv[1]).write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
