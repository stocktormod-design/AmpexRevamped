#!/usr/bin/env python3
"""Diagnostic only: match static reference patches through the actual GLB surface.
Usage: python3 tools/audit-scan-reprojection.py FIXTURE GLB OUTPUT_JSON [REFERENCE_INDEX]
Requires numpy and Pillow. Defaults to frame 5's panel ROI in the September 8 fixtures.
Reports image-space residuals; repeated panel lines and aperture ambiguity remain.
"""
import json, struct, sys
from pathlib import Path
import numpy as np
from PIL import Image
folder, model, output = map(Path, sys.argv[1:4])
reference_index = int(sys.argv[4]) if len(sys.argv)>4 else 5
frames = json.loads((folder/'fixture-kf.json').read_text())
data = model.read_bytes(); jl = struct.unpack_from('<I', data, 12)[0]
g = json.loads(data[20:20+jl]); binary = 28+jl

def accessor(i):
    a=g['accessors'][i]; b=g['bufferViews'][a['bufferView']]
    dtype={5126:'<f4',5125:'<u4'}[a['componentType']]
    n={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
    return np.frombuffer(data,dtype,count=a['count']*n,offset=binary+b.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,n)
verts=accessor(0); tri=accessor(3).reshape(-1,3); a,b,c=verts[tri[:,0]],verts[tri[:,1]],verts[tri[:,2]]
e1=b-a;e2=c-a

def camera(f):
    t=np.array(f['transform']).reshape(4,4,order='F'); return t,np.linalg.inv(t)
def rays(uv,f):
    fx,fy,cx,cy=np.array(f['intrinsics'])*960/f['width']
    r=np.stack([(uv[:,0]-cx)/fx,-(uv[:,1]-cy)/fy,-np.ones(len(uv))],axis=1)
    return r@camera(f)[0][:3,:3].T

def project(p,f):
    pc=np.column_stack([p,np.ones(len(p))])@camera(f)[1].T
    fx,fy,cx,cy=np.array(f['intrinsics'])*960/f['width']; z=-pc[:,2]
    return np.stack([fx*pc[:,0]/z+cx,-fy*pc[:,1]/z+cy],axis=1),z

def image(f):
    im=Image.open(folder/f['file']).convert('L');return np.asarray(im.resize((960,round(im.height*960/im.width))),dtype=float)/255

def sample(im,uv):
    x=uv[...,0];y=uv[...,1];x0=np.floor(x).astype(int);y0=np.floor(y).astype(int)
    ok=(x0>=0)&(y0>=0)&(x0<im.shape[1]-1)&(y0<im.shape[0]-1)
    x0=np.clip(x0,0,im.shape[1]-2);y0=np.clip(y0,0,im.shape[0]-2)
    dx=x-x0;dy=y-y0
    val=(im[y0,x0]*(1-dx)*(1-dy)+im[y0,x0+1]*dx*(1-dy)+im[y0+1,x0]*(1-dx)*dy+im[y0+1,x0+1]*dx*dy)
    return val,ok
ref=next(f for f in frames if f['index']==reference_index); origin=camera(ref)[0][:3,3]; refim=image(ref)
patches=[]
offsets=np.array([(dx,dy) for dy in range(-12,13,2) for dx in range(-12,13,2)])
basis=np.column_stack([np.ones(len(offsets)),offsets])
def detrend(values):
    return values-(values@basis)@np.linalg.pinv(basis)

# Exclude the television and border geometry; these are static panel patches.
for y in np.linspace(110,460,9):
 for x in np.linspace(150,790,10):
    ray=rays(np.array([[x,y]]),ref)[0]
    h=np.cross(ray,e2);det=np.sum(e1*h,axis=1);valid=np.abs(det)>1e-9
    inv=np.divide(1,det,out=np.zeros_like(det),where=valid);s=origin-a
    u=inv*np.sum(s*h,axis=1);q=np.cross(s,e1);v=inv*(q@ray);t=inv*np.sum(e2*q,axis=1)
    valid &= (u>=0)&(v>=0)&(u+v<=1)&(t>.1)
    if not valid.any():continue
    idx=np.argmin(np.where(valid,t,np.inf));normal=np.cross(e1[idx],e2[idx]);normal/=np.linalg.norm(normal)
    uv=np.array([x,y])+offsets; rr=rays(uv,ref);den=rr@normal
    if np.min(np.abs(den))<.1:continue
    pp=origin+rr*((a[idx]-origin)@normal/den)[:,None]
    values,_=sample(refim,uv);values=detrend(values);sd=np.linalg.norm(values)
    if sd<.06:continue
    gy,gx=np.gradient(values.reshape(13,13))
    tensor=np.array([[np.sum(gx*gx),np.sum(gx*gy)],[np.sum(gx*gy),np.sum(gy*gy)]])
    ev,vec=np.linalg.eigh(tensor)
    if ev[-1]<4*ev[0]:continue
    patches.append((uv,pp,values/sd,vec[:,-1]))
print('reference patches:',len(patches),flush=True)
lags=np.arange(-14,14.1,.5)
results=[]
for f in frames:
 im=image(f); matches=[]
 depth=np.fromfile(folder/f['depthFile'],dtype='<f4').reshape(f['depthHeight'],f['depthWidth'])
 for uv,pp,refval,refnormal in patches:
    pu,z=project(pp,f)
    center=pu[len(pu)//2];xx=int(center[0]/960*f['depthWidth']);yy=int(center[1]/im.shape[0]*f['depthHeight'])
    if z.min()<.1 or not(0<=xx<f['depthWidth'] and 0<=yy<f['depthHeight']):continue
    dz=float(depth[yy,xx])
    if not np.isfinite(dz) or dz<=0 or abs(dz-z[len(z)//2])>.10:continue
    jac=np.linalg.lstsq(np.column_stack([uv,np.ones(len(uv))]),pu,rcond=None)[0][:2,:].T
    normal=np.linalg.solve(jac.T,refnormal);normal/=np.linalg.norm(normal)
    shifts=lags[:,None]*normal[None,:]
    vals,ok=sample(im,pu[None,:,:]+shifts[:,None,:]);vals=detrend(vals)
    norms=np.linalg.norm(vals,axis=1);scores=(vals@refval)/np.maximum(norms,1e-9);scores[~ok.all(axis=1)]=-2
    peak=scores.max()
    if peak<.85:continue
    # Prefer the smallest shift within a near-peak plateau: stripes constrain only one axis.
    good=np.flatnonzero(scores>=peak-.003);j=good[np.argmin(np.linalg.norm(shifts[good],axis=1))]
    shift=shifts[j]
    if abs(lags[j])>=14:continue
    # Keep reference pixel fixed while perturbing the surface along the reference ray.
    center3=pp[len(pp)//2]; viewray=center3-origin; viewray/=np.linalg.norm(viewray)
    moved,_=project(np.array([center3+viewray*.01]),f)
    slope=float(((moved[0]-center)/.01)@normal)
    matches.append({'normal':normal.tolist(),'jacobian':jac.tolist(),'depth_slope_px_per_m':slope,'ref':uv[len(uv)//2].tolist(),'shift':shift.tolist(),'normal_shift':float(lags[j]),'ncc':float(scores[j]),'ncc_zero':float(scores[len(shifts)//2])})
 shifts_ok=np.array([m['shift'] for m in matches])
 row={'frame':f['index'],'matches':matches,'count':len(matches)}
 if len(matches):row['median_shift']=np.median(shifts_ok,axis=0).tolist();row['median_norm']=float(np.median(np.linalg.norm(shifts_ok,axis=1)))
 results.append(row);print({k:v for k,v in row.items() if k!='matches'},flush=True)
selfcheck=next(r for r in results if r['frame']==reference_index)
assert selfcheck['count']==len(patches) and selfcheck['median_norm']==0, 'Reference reprojection must be identity'
output.write_text(json.dumps({'reference':reference_index,'width':960,'patch_count':len(patches),'frames':results},indent=2))
