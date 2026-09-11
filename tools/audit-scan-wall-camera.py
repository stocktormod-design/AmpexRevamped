# Finner den største VEGGflaten i en GLB og skriver kameraet som ser rett på den.
import json,struct,sys
import numpy as np
def load(glb):
    b=open(glb,'rb').read(); ln=struct.unpack('<I',b[8:12])[0]; off=12; ch=[]
    while off<ln:
        cl=struct.unpack('<I',b[off:off+4])[0]; ch.append((off+8,cl)); off+=8+cl
    j=json.loads(b[ch[0][0]:ch[0][0]+ch[0][1]].decode()); bn=b[ch[1][0]:ch[1][0]+ch[1][1]]
    def acc(i):
        a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
        base=bv.get('byteOffset',0)+a.get('byteOffset',0)
        ct={5121:'u1',5123:'u2',5125:'u4',5126:'f4'}[a['componentType']]; n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
        return np.frombuffer(bn,dtype=np.dtype(ct),count=a['count']*n,offset=base).reshape(-1,n)
    pos=[];idx=[];vb=0
    for m in j['meshes']:
        for pr in m['primitives']:
            P=acc(pr['attributes']['POSITION']).astype(np.float64); I=acc(pr['indices']).astype(np.int64).ravel()
            pos.append(P); idx.append(I+vb); vb+=len(P)
    return np.vstack(pos), np.concatenate(idx).reshape(-1,3)
pos,idx=load(sys.argv[1])
a,b,c=pos[idx[:,0]],pos[idx[:,1]],pos[idx[:,2]]
n=np.cross(b-a,c-a); L=np.linalg.norm(n,axis=1); ok=L>1e-12
n=n[ok]/L[ok,None]; ar=0.5*L[ok]; cen=((a+b+c)/3)[ok]
vegg=np.abs(n[:,1])<0.3
n,ar,cen=n[vegg],ar[vegg],cen[vegg]
# retningsbøtter i asimut (5 grader), så plan langs samme vegg havner sammen
az=np.degrees(np.arctan2(n[:,2],n[:,0]))%360
best=None
for a0 in range(0,360,5):
    sel=(np.abs((az-a0+180)%360-180)<7.5)
    if sel.sum()<50: continue
    nn=(n[sel]*ar[sel,None]).sum(axis=0); nn/=np.linalg.norm(nn)
    d=cen[sel]@nn
    # offset-histogram 2,5 cm
    h,edges=np.histogram(d,bins=np.arange(d.min()-0.05,d.max()+0.05,0.025),weights=ar[sel])
    k=h.argmax()
    band=(d>=edges[k]-0.05)&(d<edges[k+1]+0.05)
    A=ar[sel][band].sum()
    if best is None or A>best[0]:
        best=(A,nn,cen[sel][band],ar[sel][band])
A,nn,pts,w=best
mid=(pts*w[:,None]).sum(axis=0)/w.sum()
mid[1]=np.clip(mid[1],pts[:,1].min()+0.4,pts[:,1].max()-0.4)
dist=float(sys.argv[2]) if len(sys.argv)>2 else 1.3
cam=mid+nn*dist
print(f"{cam[0]:.4f},{cam[1]:.4f},{cam[2]:.4f} {mid[0]:.4f},{mid[1]:.4f},{mid[2]:.4f} areal={A:.2f}m2", file=sys.stderr)
print(f"{cam[0]:.4f},{cam[1]:.4f},{cam[2]:.4f}|{mid[0]:.4f},{mid[1]:.4f},{mid[2]:.4f}")
