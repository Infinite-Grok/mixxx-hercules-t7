# Fixtures (copied, never modified in place)

SHA-256 of every file is in `SHA256SUMS` (checked by the `fixtures-intact` test).

| File | What it is |
|---|---|
| `reference-decoder.js` | A reference platter/motor decoder. The vinyl identity test requires the mapping's platter script to produce a byte-identical `scratch2` / `scratch2_enable` trace to this decoder running alone. |
| `recorded/device-*.json` (8 files) | Real T7 platter reports per scenario (`{name, reports:[{tau ms, cc9, pb, trueU}]}`): left_1rev_cw/ccw, left_scratch, right_1rev_cw, m_pause, m_playing_hold/nudge/scratch. |
| `recorded/device-session-first60k-platter.jsonl` | First 60 000 platter lines (CC9 + pitch-bend, deck 2) of a recorded inbound-MIDI session: 32 s of continuous platter motion (`{wall_ns, raw:[status,d1,d2]}`). It contains only the T7's own platter reports. |
| `platter-only.midi.xml` | A minimal XML with only the platter bindings, used by the platter lifecycle tests. |

The identity test is strict and simple: the mapping's full script set must produce a byte-identical `scratch2` / `scratch2_enable` trace to the reference decoder running alone.
