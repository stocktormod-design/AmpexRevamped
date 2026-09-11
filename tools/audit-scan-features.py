#!/usr/bin/env python3
"""Diagnostic SIFT matching on red panel surfaces, with mutual ratio and held-out geometry.
Not a reconstruction pipeline; a homography is valid only for the selected plane.
Requires opencv-python-headless and numpy in an isolated analysis environment.
"""
import sys,json
from pathlib import Path
import cv2 as cv
import numpy as np
root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
frames=json.loads((root/'fixture-kf.json').read_text());det=cv.SIFT_create(nfeatures=5000,contrastThreshold=.015)
cv.setRNGSeed(17)
def load(i):
 im=cv.imread(str(root/frames[i]['file']));scale=1600/im.shape[1];im=cv.resize(im,None,fx=scale,fy=scale)
 if '--rectify' in sys.argv:
  x,y=np.meshgrid(np.linspace(-.95,.65,1000),np.linspace(1.1,-.5,1000))
  world=np.stack([x,y,np.full_like(x,1.5174),np.ones_like(x)],axis=-1)
  f=frames[i];c=world@np.linalg.inv(np.array(f['transform']).reshape(4,4).T).T
  fx,fy,cx,cy=np.array(f['intrinsics'])*scale
  u=(fx*c[...,0]/-c[...,2]+cx).astype(np.float32);v=(-fy*c[...,1]/-c[...,2]+cy).astype(np.float32)
  im=cv.remap(im,u,v,cv.INTER_LINEAR,borderMode=cv.BORDER_CONSTANT)
 b,g,r=cv.split(im.astype(np.float32));mask=((r>40)&(r>g*1.6)&(r>b*1.4)).astype(np.uint8)*255
 kp,des=det.detectAndCompute(cv.cvtColor(im,cv.COLOR_BGR2GRAY),None if '--full' in sys.argv else mask)
 return im,kp,des
target=next((int(a.split('=')[1]) for a in sys.argv if a.startswith('--target=')),60)
indices=next(([int(i) for i in a.split('=')[1].split(',')] for a in sys.argv if a.startswith('--frames=')),[54,55,58,59,60,61,62,107])
assert target in indices and all(0<=i<len(frames) for i in indices), 'Target and frame indices must exist in fixture'
cache={i:load(i) for i in indices};results=[]
bf=cv.BFMatcher(cv.NORM_L2)
for i in [i for i in cache if i!=target]:
 a,ka,da=cache[i];b,kb,db=cache[target]
 if da is None or db is None:continue
 def ratios(x,y):return {m.queryIdx:m for m,n in bf.knnMatch(x,y,k=2) if m.distance<.7*n.distance}
 forward=ratios(da,db);reverse=ratios(db,da)
 matches=[m for m in forward.values() if m.trainIdx in reverse and reverse[m.trainIdx].trainIdx==m.queryIdx]
 row={'reference':i,'target':target,'features':[len(ka),len(kb)],'mutual_matches':len(matches)}
 if len(matches)>=12:
  src=np.float32([ka[m.queryIdx].pt for m in matches]);dst=np.float32([kb[m.trainIdx].pt for m in matches]);held=np.arange(len(matches))%5==0
  fundamental,fmask=cv.findFundamentalMat(src[~held],dst[~held],cv.FM_RANSAC,2.0,.999)
  if fundamental is not None and fundamental.shape==(3,3):
   x=np.column_stack([src,np.ones(len(src))]);y=np.column_stack([dst,np.ones(len(dst))]);fx=x@fundamental.T;fy=y@fundamental
   sampson=np.abs(np.sum(y*fx,axis=1))/np.sqrt(np.maximum(1e-12,np.sum(fx[:,:2]**2,axis=1)+np.sum(fy[:,:2]**2,axis=1)))
   row.update({'fundamental':fundamental.tolist(),'epipolar_errors':sampson.tolist(),'epipolar_train_inliers':int(fmask.sum()),'epipolar_held_median_px':float(np.median(sampson[held])),'epipolar_held_under2px':int(np.sum(sampson[held]<2))})
  h,mask=cv.findHomography(src[~held],dst[~held],cv.RANSAC,3.0,maxIters=5000,confidence=.999)
  if h is not None:
   train_support=dst[~held][mask.ravel().astype(bool)]
   span=np.ptp(train_support,axis=0)/np.array([b.shape[1],b.shape[0]])
   row['homography_train_target_span_fraction']=span.tolist()
   prediction=cv.perspectiveTransform(src[:,None,:],h)[:,0,:];error=np.linalg.norm(prediction-dst,axis=1)
   good=error<3;row.update({'homography':h.tolist(),'train_inliers':int(mask.sum()),'held_count':int(held.sum()),'held_inliers':int(good[held].sum()),'held_median_px':float(np.median(error[held])),'source_points':src.tolist(),'target_points':dst.tolist(),'errors':error.tolist(),'held':held.tolist()})
   canvas=cv.drawMatches(a,ka,b,kb,matches,None,matchesMask=good.astype(int).tolist(),flags=cv.DrawMatchesFlags_NOT_DRAW_SINGLE_POINTS)
   cv.imwrite(str(out/f'matches-{i}-{target}.jpg'),canvas)
   # Same target view: aligned source overlay exposes wrong repeated-tile matches.
   warped=cv.warpPerspective(a,h,(b.shape[1],b.shape[0]));valid=cv.warpPerspective(np.ones(a.shape[:2],np.uint8),h,(b.shape[1],b.shape[0]))>0
   overlay=b.copy();overlay[valid]=cv.addWeighted(b,.5,warped,.5,0)[valid]
   cv.imwrite(str(out/f'overlay-{i}-{target}.jpg'),overlay)
 results.append(row)
print(json.dumps([{k:v for k,v in row.items() if k not in ['homography','fundamental','epipolar_errors','source_points','target_points','errors','held']} for row in results],indent=2))
(out/'results.json').write_text(json.dumps({'opencv':cv.__version__,'pairs':results},indent=2))
