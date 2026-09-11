#!/usr/bin/env python3
"""Exercise the exact bounded, concurrent capture journal without ARKit."""
from pathlib import Path
import subprocess
import tempfile
source = (Path(__file__).resolve().parents[1]/'modules/ampex-splat/ios/MeshScanPresenter.swift').read_text()
body = source.split('// BEGIN CAPTURE DECISION AUDIT')[1].split('\n', 1)[1].split('// END CAPTURE DECISION AUDIT')[0]
checks = r'''
let audit = CaptureDecisionAudit(limit: 2)
audit.record(time: 10, reason: "saved_new", bucket: Int64.max, index: 3, score: 1)
audit.record(time: 12, reason: "saved_replacement", index: 3, previousTime: 10, score: .infinity, blur: .nan)
audit.record(time: 13, reason: "not_better")
let snapshot = try JSONDecoder().decode(CaptureDecisionAudit.Snapshot.self, from: audit.data())
assert(snapshot.total == 3 && snapshot.dropped == 1 && snapshot.events.count == 2)
assert(snapshot.events[0].bucket == "9223372036854775807")
assert(snapshot.events[1].previousTime == 10 && snapshot.events[1].index == 3)
assert(snapshot.events[1].score == nil && snapshot.events[1].blur == nil)
assert(snapshot.counts["not_better"] == 1)
let concurrent = CaptureDecisionAudit(limit: 100)
DispatchQueue.concurrentPerform(iterations: 1000) { i in
    concurrent.record(time: Double(i), reason: i % 2 == 0 ? "dispatch" : "not_better")
}
let c = try JSONDecoder().decode(CaptureDecisionAudit.Snapshot.self, from: concurrent.data())
assert(c.total == 1000 && c.dropped == 900 && c.events.count == 100)
assert(c.counts["dispatch"] == 500 && c.counts["not_better"] == 500)
let zero = CaptureDecisionAudit(limit: 0)
zero.record(time: 1, reason: "tracking")
let z = try JSONDecoder().decode(CaptureDecisionAudit.Snapshot.self, from: zero.data())
assert(z.events.isEmpty && z.total == 1 && z.dropped == 1)
print("PASS: exact production capture journal; cap, concurrent counts, replacement lineage, JSON precision and nonfinite metrics.")
'''
with tempfile.TemporaryDirectory(prefix='ampex-audit-') as d:
    p = Path(d)/'main.swift'; p.write_text('import Foundation\n'+body+checks)
    subprocess.run(['swift', '-module-cache-path', d+'/cache', str(p)], check=True)
