#!/usr/bin/env python3
# Hvor tykt er gulvet og taket i en ferdig GLB? Alle hjørner med loddrett normal → y-histogram.
# Ett skall = én smal topp; posedrift gir et tykt eller dobbelt skall. Bruk: audit-scan-shell.py a.glb [b.glb …]
# Geometrisk mål på driften i den FERDIGE modellen: hvor "tykt" gulv og tak er.
# Alle hjørner fra alle primitiver → y-histogram (1 cm) rundt gulv og tak. Ett skall = én smal topp.
import sys, json, struct, numpy as np
for path in sys.argv[1:]:
    d=open(path,'rb').read(); off=12; js=None; binc=None
    while off < len(d):
        ln, ty = struct.unpack_from('<II', d, off); chunk=d[off+8:off+8+ln]; off+=8+ln
        if ty==0x4E4F534A: js=json.loads(chunk)
        elif ty==0x004E4942: binc=chunk
    def acc(i):
        a=js['accessors'][i]; bv=js['bufferViews'][a['bufferView']]
        st=bv.get('byteOffset',0)+a.get('byteOffset',0)
        n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
        dt={5126:np.float32,5125:np.uint32,5123:np.uint16}[a['componentType']]
        return np.frombuffer(binc, dtype=dt, count=a['count']*n, offset=st).reshape(a['count'],n)
    P=[]; N=[]
    for m in js['meshes']:
        for pr in m['primitives']:
            P.append(acc(pr['attributes']['POSITION']))
            if 'NORMAL' in pr['attributes']: N.append(acc(pr['attributes']['NORMAL']))
    P=np.concatenate(P).astype(np.float64); N=np.concatenate(N).astype(np.float64) if N else None
    print(f"== {path.split('/')[-1]}: {len(P)} hjørner")
    horiz = np.abs(N[:,1])>0.9 if N is not None else np.ones(len(P),bool)
    y=P[horiz,1]
    for navn,(lo,hi) in {'gulv':(-1.7,-1.1),'tak':(0.7,1.3)}.items():
        sel=y[(y>lo)&(y<hi)]
        if len(sel)<100: print(f"  {navn}: for få"); continue
        h,edges=np.histogram(sel,bins=int((hi-lo)*100),range=(lo,hi))
        peak=edges[h.argmax()]
        # andel innenfor ±2 cm av toppen, og p10–p90-bredde
        near=np.mean(np.abs(sel-peak-0.005)<0.02)
        print(f"  {navn}: topp {peak*1000:.0f} mm, {near*100:.0f} % innen ±2 cm, p10–p90 {np.percentile(sel,10)*1000:.0f}..{np.percentile(sel,90)*1000:.0f} mm, std {sel.std()*1000:.0f} mm, n={len(sel)}")
        # skriv histogram kompakt
        top=h.max()
        print("   ", ' '.join(f"{int(edges[i]*100)}:{'#'*int(8*h[i]/top)}" for i in range(len(h)) if h[i]>top*0.08))
