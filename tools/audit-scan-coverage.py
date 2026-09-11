#!/usr/bin/env python3
"""Measure exported mesh coverage from native winner labels, in m² and UV area.
Usage: script GLB trace-directory. No screenshot/color heuristics are used.
"""
import json, struct, sys
from pathlib import Path
import numpy as np
path=Path(sys.argv[1]);data=path.read_bytes();n=struct.unpack_from('<I',data,12)[0]
meta=json.loads(data[20:20+n]);start=28+n
def read(i):
    a=meta['accessors'][i];b=meta['bufferViews'][a['bufferView']]
    assert 'byteStride' not in b, 'Requires Ampex contiguous accessor layout'
    k={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
    return np.frombuffer(data,dtype={5126:'<f4',5125:'<u4'}[a['componentType']],count=a['count']*k,offset=start+b.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,k)
v=read(0).astype(float);uv=read(2).astype(float);tri=read(3).reshape(-1,3)
labels=np.fromfile(Path(sys.argv[2])/'labels-winner.i32',dtype='<i4')
assert len(labels)==len(tri), 'Trace must match exported GLB'
xyz=v[tri];tex=uv[tri];ab=xyz[:,1]-xyz[:,0];ac=xyz[:,2]-xyz[:,0]
area=np.linalg.norm(np.cross(ab,ac),axis=1)*.5
a=tex[:,1]-tex[:,0];b=tex[:,2]-tex[:,0];uv_area=np.abs(a[:,0]*b[:,1]-a[:,1]*b[:,0])*.5
missing=labels<0;centers=xyz.mean(axis=1)
order=np.flatnonzero(missing)[np.argsort(area[missing])[::-1]][:20]
frames=json.loads((Path(sys.argv[2])/'refined-kf.json').read_text())
assigned_inside=np.zeros(len(tri),dtype=bool);any_inside=np.zeros(len(tri),dtype=bool)
for index,f in enumerate(frames):
    camera=np.column_stack([centers,np.ones(len(tri))])@np.linalg.inv(np.array(f['transform']).reshape(4,4).T).T
    z=-camera[:,2];fx,fy,cx,cy=f['intrinsics']
    safe=np.where(np.abs(z)>1e-8,z,1e-8)
    px=fx*camera[:,0]/safe+cx;py=-fy*camera[:,1]/safe+cy
    inside=(z>.05)&(px>=0)&(py>=0)&(px<f['width'])&(py<f['height'])
    any_inside|=inside;assigned_inside|=inside&(labels==index)
print(json.dumps({'mesh':str(path),'triangles':len(tri),'missing_triangles':int(missing.sum()),
 'total_m2':float(area.sum()),'missing_m2':float(area[missing].sum()),
 'world_coverage_percent':float(100*(1-area[missing].sum()/area.sum())),
 'uv_coverage_percent':float(100*(1-uv_area[missing].sum()/uv_area.sum())),
 'assigned_centroids_outside_chosen_photo':int((~missing&~assigned_inside).sum()),
 'assigned_centroids_outside_chosen_photo_m2':float(area[~missing&~assigned_inside].sum()),
 'missing_centroids_in_any_photo_m2':float(area[missing&any_inside].sum()),
 'note':'Photo bounds test uses triangle centroids only, without occlusion/depth checks; not actual pixel coverage.',
 'largest_missing':[{'triangle':int(i),'area_m2':float(area[i]),'center':centers[i].tolist()} for i in order]},indent=2))
