#!/usr/bin/env python3
"""Summarize native edge constraints and test an affine field on held-out matches.
This is a diagnostic model comparison, not an image-quality acceptance test.
"""
import json,sys
from pathlib import Path
import numpy as np

def audit(path, fixture=None, export=None):
    data=json.loads(Path(path).read_text()); rows=data['matches']; n=len(data['frames'])
    held=np.array([r['held'] for r in rows]); residual=np.array([r['residual'] for r in rows])
    before=np.array([r['shift'] for r in rows])
    def stats(x):
        x=np.abs(x)
        return {'median':round(float(np.median(x)),3),'p90':round(float(np.quantile(x,.9)),3),'over2px':round(float(np.mean(x>2)),3)}
    result={'frames':n,'constraints':len(rows),'held':int(held.sum()),'raw':stats(before[held]),'global':stats(residual[held]),
            'held_worsened_over_1px':round(float(np.mean(np.abs(residual[held])>np.abs(before[held])+1)),3)}
    # Report both raw connectivity and links supported by several correspondences.
    pairs={}
    for r in rows:
        pair=tuple(sorted([r['r'],r['t']]))
        pairs.setdefault(pair,set()).add(r['pair'])
    for minimum in [1,6]:
        graph=[set() for _ in range(n)]
        for (i,j),matches in pairs.items():
            if len(matches)>=minimum:graph[i].add(j);graph[j].add(i)
        seen=set();components=[]
        for i in range(n):
            if i in seen:continue
            group=set();todo=[i]
            while todo:
                j=todo.pop()
                if j in group:continue
                group.add(j);todo.extend(graph[j]-group)
            seen.update(group);components.append(sorted(group))
        result['components_min_'+str(minimum)]={'sizes':sorted(map(len,components),reverse=True),'isolated':[i for i in range(n) if not graph[i]]}
    # Spatially varying correction about the native global field. No held rows in fit.
    # Six coefficients/frame: displacement x/y, each affine in centered image x/y.
    design=np.zeros((len(rows),n*6))
    for k,r in enumerate(rows):
        for side in ['R','T']:
            i=r[side.lower()]; c=r['c'+side.lower()]; uv=r['uv'+side]; f=data['frames'][i]
            basis=np.array([1,uv[0]/f['width']-.5,uv[1]/f['height']-.5])
            design[k,i*6:i*6+3]+=c[0]*basis
            design[k,i*6+3:i*6+6]+=c[1]*basis
    anchor=data['anchor']; design[:,anchor*6:anchor*6+6]=0
    a=design[~held]; y=-residual[~held]
    for strength in [1.,10.,100.]:
        fit=np.zeros(n*6)
        for _ in range(8):
            w=np.minimum(1,1.5/np.maximum(np.abs(a@fit-y),1e-6))
            fit=np.linalg.solve(a.T@(w[:,None]*a)+np.eye(n*6)*strength,a.T@(w*y))
        error=residual+design@fit
        result['affine_ridge_'+str(strength)]=stats(error[held])
        if strength == 1 and export:
            # Fixture-order mapping is valid only when every original frame was decoded
            # and retained. Refuse filtered fixtures; native audits currently have no IDs.
            kf=json.loads(Path(fixture).read_text())
            assert len(kf)==n, 'Filtered fixture requires an explicit native frame-ID map'
            fields={}
            for i,f in enumerate(data['frames']):
                assert abs(kf[i]['width']/kf[i]['height']-f['width']/f['height'])<.01
                nodes=[]
                for yy in range(8):
                    for xx in range(12):
                        basis=np.array([1,xx/11-.5,yy/7-.5])
                        delta=np.array(data['offsets'][i])+fit[i*6:i*6+6].reshape(2,3)@basis
                        assert np.max(np.abs(delta))<=32, 'Unsafe extrapolated field'
                        nodes.append((delta/[f['width'],f['height']]).tolist())
                fields[str(kf[i]['index'])]=nodes
            Path(export).write_text(json.dumps({'gridWidth':12,'gridHeight':8,'fields':fields}))
    # Group held constraints by image and quadrant, counting a correspondence in
    # both images. These descriptive bins are correlated; not independent samples.
    bins={}
    for r in rows:
        if not r['held']:continue
        for side in ['R','T']:
            i=r[side.lower()];f=data['frames'][i];uv=r['uv'+side]
            q=(int(uv[0]>=f['width']/2),int(uv[1]>=f['height']/2))
            bins.setdefault((i,*q),[]).append(r['residual'])
    result['worst_quadrants']=[{'frame':k[0],'quadrant':list(k[1:]),'count':len(v),**stats(v)} for k,v in sorted(bins.items(),key=lambda kv:np.median(np.abs(kv[1])),reverse=True) if len(v)>=5][:12]
    return result

if __name__=='__main__':
    print(json.dumps(audit(sys.argv[1],sys.argv[2] if len(sys.argv)>2 else None,sys.argv[3] if len(sys.argv)>3 else None),indent=2))
