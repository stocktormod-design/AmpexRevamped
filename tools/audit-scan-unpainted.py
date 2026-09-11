import json, struct, sys, math
import numpy as np
glb, trace = sys.argv[1], sys.argv[2]
b=open(glb,'rb').read(); ln=struct.unpack('<I',b[8:12])[0]; off=12; ch=[]
while off<ln:
    cl=struct.unpack('<I',b[off:off+4])[0]; ch.append((off+8,cl)); off+=8+cl
j=json.loads(b[ch[0][0]:ch[0][0]+ch[0][1]].decode('utf8')); bin_=b[ch[1][0]:ch[1][0]+ch[1][1]]
def acc(i):
    a=j['accessors'][i]; bv=j['bufferViews'][a['bufferView']]
    base=bv.get('byteOffset',0)+a.get('byteOffset',0)
    ct={5121:'u1',5123:'u2',5125:'u4',5126:'f4'}[a['componentType']]
    n={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']]
    arr=np.frombuffer(bin_,dtype=np.dtype(ct),count=a['count']*n,offset=base)
    return arr.reshape(a['count'],n) if n>1 else arr
pos=[];idx=[];vb=0
for m in j['meshes']:
    for pr in m['primitives']:
        P=acc(pr['attributes']['POSITION']).astype(np.float64); I=acc(pr['indices']).astype(np.int64)
        pos.append(P); idx.append(I+vb); vb+=len(P)
pos=np.vstack(pos); idx=np.concatenate(idx).reshape(-1,3)
win=np.frombuffer(open(trace+'/labels-winner.i32','rb').read(),dtype='<i4')
assert len(win)==len(idx), (len(win),len(idx))
a,bb,c=pos[idx[:,0]],pos[idx[:,1]],pos[idx[:,2]]
area=0.5*np.linalg.norm(np.cross(bb-a,c-a),axis=1)
cen=(a+bb+c)/3.0
nrm=np.cross(bb-a,c-a); nl=np.linalg.norm(nrm,axis=1); nrm=nrm/np.maximum(nl[:,None],1e-12)
bad=win<0
print(f"flater {len(idx)}, umalte {bad.sum()} ({100*bad.sum()/len(idx):.1f}%)")
print(f"areal totalt {area.sum():.1f} m2, umalt {area[bad].sum():.2f} m2 ({100*area[bad].sum()/area.sum():.1f}%)")
kf=json.load(open(trace+'/refined-kf.json'))
seen=np.zeros(bad.sum(),dtype=np.int32); front=np.zeros(bad.sum(),dtype=np.int32)
cb=cen[bad]; nb=nrm[bad]
for k in kf:
    T=np.array(k['transform'],dtype=np.float64).reshape(4,4).T   # column-major → row
    R=T[:3,:3]; t=T[:3,3]
    fx,fy,cx,cy=k['intrinsics']; W,H=k['width'],k['height']
    # ARKit-kamera: -Z framover, Y opp → verden→kamera
    d=cb-t
    xc=d@R[:,0]; yc=d@R[:,1]; zc=d@R[:,2]
    z=-zc
    ok=z>0.05
    u=fx*(xc/np.where(z>1e-6,z,1))+cx
    v=fy*(-yc/np.where(z>1e-6,z,1))+cy
    inside=ok&(u>=0)&(u<W)&(v>=0)&(v<H)
    seen+=inside
    # frontvendt: normalen mot kameraet
    ndot=-(nb@R[:,0]*0)  # placeholder
    view=(t-cb); view=view/np.maximum(np.linalg.norm(view,axis=1)[:,None],1e-9)
    facing=(nb*view).sum(axis=1)>0.25
    front+=(inside&facing)
print(f"umalte flater i minst ett kamerabilde: {(seen>0).sum()} ({100*(seen>0).sum()/len(seen):.1f}%)")
print(f"  ... og frontvendt (>75 grader): {(front>0).sum()} ({100*(front>0).sum()/len(seen):.1f}%)")
print(f"aldri i noe bilde: {(seen==0).sum()} ({100*(seen==0).sum()/len(seen):.1f}%)  areal {area[bad][seen==0].sum():.2f} m2")
# hvor ligger de umalte? grovt: vegg (|ny|<0.5) vs gulv/tak
ny=np.abs(nrm[bad][:,1])
print(f"umalt fordelt: vegg {100*(ny<0.5).mean():.0f}%, gulv/tak {100*(ny>=0.5).mean():.0f}%")
lo=cb.min(axis=0); hi=cb.max(axis=0)
print("umalt bbox", np.round(lo,2), np.round(hi,2))
