import json,struct,sys
import numpy as np
glb,trace=sys.argv[1],sys.argv[2]
b=open(glb,'rb').read(); ln=struct.unpack('<I',b[8:12])[0]; off=12; ch=[]
while off<ln:
    cl=struct.unpack('<I',b[off:off+4])[0]; ch.append((off+8,cl)); off+=8+cl
j=json.loads(b[ch[0][0]:ch[0][0]+ch[0][1]].decode()); bin_=b[ch[1][0]:ch[1][0]+ch[1][1]]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    base=bv.get('byteOffset',0)+a.get('byteOffset',0)
    ct={5121:'u1',5123:'u2',5125:'u4',5126:'f4'}[a['componentType']]; n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
    return np.frombuffer(bin_,dtype=np.dtype(ct),count=a['count']*n,offset=base).reshape(-1,n)
pos=[];idx=[];vb=0
for m in j['meshes']:
    for pr in m['primitives']:
        P=acc(pr['attributes']['POSITION']).astype(np.float64); I=acc(pr['indices']).astype(np.int64).ravel()
        pos.append(P); idx.append(I+vb); vb+=len(P)
pos=np.vstack(pos); idx=np.concatenate(idx).reshape(-1,3)
win=np.frombuffer(open(trace+'/labels-winner.i32','rb').read(),dtype='<i4')
plane=np.frombuffer(open(trace+'/labels-plane.i32','rb').read(),dtype='<i4')
a,bb,c=pos[idx[:,0]],pos[idx[:,1]],pos[idx[:,2]]
area=0.5*np.linalg.norm(np.cross(bb-a,c-a),axis=1)
nrm=np.cross(bb-a,c-a); nrm/=np.maximum(np.linalg.norm(nrm,axis=1)[:,None],1e-12)
vegg=(np.abs(nrm[:,1])<0.4)
print("planetiketter på veggflater:", np.unique(plane[vegg]).size, "unike;", 
      "flater uten plan:", int((plane[vegg]<0).sum()), "av", int(vegg.sum()))
# største planet
vals,cnts=np.unique(plane[vegg & (plane>=0)],return_counts=True)
if len(vals):
    for p,cn in sorted(zip(vals,cnts),key=lambda x:-x[1])[:4]:
        sel=(plane==p)
        w=win[sel]
        uw,uc=np.unique(w[w>=0],return_counts=True)
        andel=uc.max()/max(uc.sum(),1)
        print(f"  plan {p}: {cn} flater, {area[sel].sum():.1f} m2, {len(uw)} ulike vinnerfoto, største foto dekker {100*andel:.0f}%")
# sømlengde: kanter der vinner skifter
from collections import defaultdict
edge=defaultdict(list)
for t in range(len(idx)):
    i0,i1,i2=idx[t]
    for u,v in ((i0,i1),(i1,i2),(i2,i0)):
        edge[(min(u,v),max(u,v))].append(t)
sl=0.0; n=0
for (u,v),ts in edge.items():
    if len(ts)==2 and win[ts[0]]!=win[ts[1]] and win[ts[0]]>=0 and win[ts[1]]>=0 and vegg[ts[0]] and vegg[ts[1]]:
        sl+=np.linalg.norm(pos[u]-pos[v]); n+=1
# regionfordeling på plan 0
sel=np.where(plane==0)[0]
if len(sel):
    setsel=set(sel.tolist())
    adj={}
    for (u,v),ts in edge.items():
        if len(ts)==2 and ts[0] in setsel and ts[1] in setsel and win[ts[0]]==win[ts[1]] and win[ts[0]]>=0:
            adj.setdefault(ts[0],[]).append(ts[1]); adj.setdefault(ts[1],[]).append(ts[0])
    seen=set(); regs=[]
    for t in sel:
        if t in seen or win[t]<0: continue
        st=[t]; seen.add(t); ar=0.0
        while st:
            x=st.pop(); ar+=area[x]
            for y in adj.get(x,[]):
                if y not in seen: seen.add(y); st.append(y)
        regs.append(ar)
    regs.sort(reverse=True)
    tot=sum(regs)
    print(f"plan 0 regioner: {len(regs)}, største {', '.join(f'{r:.2f}' for r in regs[:5])} m2; "
          f"regioner >0,5 m2 dekker {100*sum(r for r in regs if r>0.5)/tot:.0f}% av planet")
# fordeling: sømmer der begge sider ligger på plan / én / ingen
pp=oo=po=0.0
for (u,v),ts in edge.items():
    if len(ts)!=2: continue
    t0,t1=ts
    if win[t0]==win[t1] or win[t0]<0 or win[t1]<0: continue
    if not (vegg[t0] and vegg[t1]): continue
    L=np.linalg.norm(pos[u]-pos[v])
    a0,a1=plane[t0]>=0,plane[t1]>=0
    if a0 and a1: pp+=L
    elif a0 or a1: po+=L
    else: oo+=L
print(f"  av sømmen: begge på plan {pp:.0f} m, én på plan {po:.0f} m, ingen på plan {oo:.0f} m")
print(f"sømlengde på vegg (vinnerskifte): {sl:.1f} m over {n} kanter; veggareal {area[vegg].sum():.1f} m2 → {sl/max(area[vegg].sum(),1e-9):.2f} m søm per m2")
