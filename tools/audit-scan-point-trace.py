#!/usr/bin/env python3
"""Summarize the native point trace; scores describe candidate weighting, not final pixels."""
import json,sys
from pathlib import Path
import numpy as np
folder=Path(sys.argv[1])
rows=json.loads((folder/'point-trace.json').read_text())
frames=json.loads((folder/'refined-kf.json').read_text())
summary=[]
for row in rows:
    corners=np.array(row['cornerOffsets'])
    winner=row['winner']
    entry={'triangle':row['triangle'],'center':row['center'],'mode':row['mode'],
           'locked':row.get('locked'),'plane':row.get('plane'),
           'winner_file':frames[winner]['file'] if winner>=0 else None,
           'views':len(row['views']),'feather_views':len(row['feather']),
           'region_offset':row['regionOffset'],
           'corner_offset_min':corners.min(axis=0).tolist(),
           'corner_offset_max':corners.max(axis=0).tolist(),
           'corner_offset_range':np.ptp(corners,axis=0).tolist()}
    total=sum(v['score'] for v in row['views'])
    entry['top_candidates']=[{'file':v['file'],'score_fraction':v['score']/total,'tone':v.get('tone')} for v in sorted(row['views'],key=lambda v:v['score'],reverse=True)[:6]]
    summary.append(entry)
print(json.dumps(summary,indent=2))
