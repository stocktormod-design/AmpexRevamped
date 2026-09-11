#!/usr/bin/env python3
"""Explain retained-RGB gaps from a capture-decisions.json journal.
Usage: script fixture-kf.json capture-decisions.json
Replacement lineage is searched across the entire log, including after a gap.
Truncated/missing logs cannot establish complete counts or the absence of capture.
"""
import json
import sys
from pathlib import Path


def explain(frames, audit):
    frames = sorted(frames, key=lambda f: f['timestamp'])
    events = audit['events']; gaps = []
    for a, b in zip(frames, frames[1:]):
        low, high = a['timestamp'], b['timestamp']
        if high-low < 1:
            continue
        inside = [e for e in events if low < e['time'] < high]
        counts = {}
        for e in inside:
            counts[e['reason']] = counts.get(e['reason'], 0)+1
        replacements = [e for e in events if e['reason'] == 'saved_replacement'
                        and low < e.get('previousTime', float('-inf')) < high]
        gaps.append({'from_frame': a['index'], 'to_frame': b['index'], 'seconds': high-low,
                     'events_inside_by_reason': counts,
                     'overwritten_captures_inside': [{'timestamp': e['previousTime'], 'replaced_at': e['time'],
                                                      'index': e.get('index')} for e in replacements]})
    return {'journal_truncated': audit['dropped'] > 0, 'dropped_events': audit['dropped'],
            'scope': 'Recorded decisions only; does not prove image sharpness or correspondence quality.',
            'gaps': sorted(gaps, key=lambda g: g['seconds'], reverse=True)}


if __name__ == '__main__':
    print(json.dumps(explain(json.loads(Path(sys.argv[1]).read_text()), json.loads(Path(sys.argv[2]).read_text())), indent=2))
