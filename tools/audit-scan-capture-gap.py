# Så kameraet de UMALTE flatene i det hele tatt, i dybdestrømmen?
import json,struct,sys
import numpy as np
glb,trace,bundle=sys.argv[1],sys.argv[2],sys.argv[3]
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
pos=np.vstack(pos); idx=np.concatenate(idx).reshape(-1,3)
win=np.frombuffer(open(trace+'/labels-winner.i32','rb').read(),dtype='<i4')
a,b2,c=pos[idx[:,0]],pos[idx[:,1]],pos[idx[:,2]]
area=0.5*np.linalg.norm(np.cross(b2-a,c-a),axis=1); cen=(a+b2+c)/3
nrm=np.cross(b2-a,c-a); nrm/=np.maximum(np.linalg.norm(nrm,axis=1)[:,None],1e-12)
bad=win<0
cb,nb,ab=cen[bad],nrm[bad],area[bad]
dense=[json.loads(l) for l in open(bundle+'/dense.jsonl')]
kf=json.load(open(trace+'/refined-kf.json'))
def sett(frames, getm, getintr, getwh):
    seen=np.zeros(len(cb),dtype=np.int32)
    for f in frames:
        T=np.array(getm(f)).reshape(4,4).T; R=T[:3,:3]; t=T[:3,3]
        fx,fy,cx,cy=getintr(f); W,H=getwh(f)
        d=cb-t; z=-(d@R[:,2])
        u=fx*(d@R[:,0])/np.where(z>1e-6,z,1)+cx; v=fy*(-(d@R[:,1]))/np.where(z>1e-6,z,1)+cy
        view=(t-cb); view/=np.maximum(np.linalg.norm(view,axis=1)[:,None],1e-9)
        seen+=(z>0.15)&(z<6)&(u>=0)&(u<W)&(v>=0)&(v<H)&((nb*view).sum(axis=1)>0.34)
    return seen
sd=sett(dense, lambda f:f['m'], lambda f:(f['fx'],f['fy'],f['cx'],f['cy']), lambda f:(f['w'],f['h']))
sk=sett(kf, lambda f:f['transform'], lambda f:f['intrinsics'], lambda f:(f['width'],f['height']))
print(f"umalt areal {ab.sum():.2f} m2 ({bad.sum()} flater)")
print(f"  sett av MINST ETT dybdebilde (kameraet PEKTE dit): {100*(sd>0).mean():.1f} %  areal {ab[sd>0].sum():.2f} m2")
print(f"  sett av minst ett LAGRET foto: {100*(sk>0).mean():.1f} %")
print(f"  antall dybdebilder som så dem, median: {np.median(sd[sd>0]) if (sd>0).any() else 0:.0f}")
d0=[l for l in dense]
print(f"dybdebilder: {len(dense)}, lagrede foto: {len(kf)}")
