#!/usr/bin/env python3
# Måler posedrift i et skann-bundle: plan-offset (gulv/tak/vegg) over tid med RÅ poser
# (dense.jsonl) og — hvis harnessen ble kjørt med -meshscan.driftdump on — med RETTEDE
# poser (drift-poser.jsonl). Bruk: audit-scan-drift.py <bundleDir>. Se SKANN_BESLUTNINGER §97.
# Måler gulv/tak/vegg-offset over tid med RÅ poser (dense.jsonl) og RETTEDE poser (drift-poser.jsonl).
import json, os, math, sys, numpy as np
B=sys.argv[1] if len(sys.argv)>1 else 'bundle'
raw=[json.loads(l) for l in open(f'{B}/dense.jsonl') if l.strip()]
byT={round(m['t'],3):m for m in raw}
rett=[json.loads(l) for l in open(f'{B}/drift-poser.jsonl') if l.strip()] if os.path.exists(f'{B}/drift-poser.jsonl') else []
rng=np.random.default_rng(0)
def analyse(entries, label):
    t0=raw[0]['t']; planes=[]
    for m,M in entries:
        p=f"{B}/dense-{m['i']}.f32"
        if not os.path.exists(p): continue
        d=np.fromfile(p,dtype=np.float32).reshape(m['h'],m['w'])
        ys,xs=np.mgrid[0:m['h'],0:m['w']]; z=d; ok=(z>0.3)&(z<5.0)
        pc=np.stack([(xs-m['cx'])/m['fx']*z, -(ys-m['cy'])/m['fy']*z, -z],-1)[ok]
        pw=pc@M[:3,:3].T+M[:3,3]
        P=pw[rng.choice(len(pw),min(6000,len(pw)),replace=False)]
        best=None
        for _ in range(60):
            s=P[rng.choice(len(P),3,replace=False)]
            n=np.cross(s[1]-s[0],s[2]-s[0]); nn=np.linalg.norm(n)
            if nn<1e-6: continue
            n/=nn; dd=-n@s[0]; inl=np.abs(P@n+dd)<0.02
            if best is None or inl.sum()>best[0]: best=(inl.sum(),n,dd,inl)
        if best is None or best[0]<len(P)*0.25: continue
        Q=P[best[3]]; c=Q.mean(0); u,s_,vt=np.linalg.svd(Q-c); n=vt[2]
        if n@(M[:3,3]-c)<0: n=-n   # mot kameraet
        planes.append((m['t']-t0,n,-n@c))
    cl=[]
    for t,n,dd in planes:
        for c in cl:
            if n@c['n']>math.cos(math.radians(8)) and abs(dd-c['d'])<0.15: c['m'].append((t,dd)); break
        else: cl.append({'n':n,'d':dd,'m':[(t,dd)]})
    cl.sort(key=lambda c:-len(c['m']))
    print(f"\n== {label}: {len(planes)} kart")
    for c in cl[:6]:
        ms=np.array(c['m']);
        if len(ms)<8: continue
        kind='GULV' if c['n'][1]>0.8 else ('TAK' if c['n'][1]<-0.8 else 'vegg')
        o=ms[:,1]; tt=ms[:,0]
        print(f"  {kind:5s} n=({c['n'][0]:+.2f},{c['n'][1]:+.2f},{c['n'][2]:+.2f}) kart={len(o):3d} p10–p90 {np.percentile(o,10)*1000:.0f}..{np.percentile(o,90)*1000:.0f} mm (spenn {np.percentile(o,90)*1000-np.percentile(o,10)*1000:.0f})  ", end='')
        for w0 in range(0,int(tt.max())+1,20):
            sel=(tt>=w0)&(tt<w0+20)
            if sel.sum()>=2: print(f"{w0}s:{o[sel].mean()*1000:.0f}", end=' ')
        print()
def M_of(t): return np.array(t,dtype=float).reshape(4,4).T
analyse([(m,M_of(m['m'])) for m in raw], "RÅ poser")
if rett:
    ent=[]
    for r in rett:
        if r['kf']!=-1: continue
        m=byT.get(round(r['t'],3))
        if m: ent.append((m,M_of(r['m'])))
    analyse(ent, "RETTEDE poser")
