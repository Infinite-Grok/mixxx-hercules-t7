# tests/ : offline test suite for the T7 Mixxx 2.5 mapping

Needs Node 22 or newer. No Mixxx and no device are needed. From the repo root:

    node tests/run.cjs res/controllers          # the suite (exit code 1 if any test fails)
    node tests/selftest.cjs                     # negative controls: the suite must fail on 15 known breakages

Options of `run.cjs`: `[candidateDir] [--json out.json] [--seen names.txt] [--only text] [--list]`.
`candidateDir` holds one `.xml` and the script files its `<scriptfiles>` names. It defaults to `$T7_CANDIDATE`, else `res/controllers` of this repo.
If the motor sender functions are not `T7.setMotor` / `T7.setMotorSpeed`, set `T7_MOTOR_FNS=Ns.fnA,Ns.fnB`.

| Path | What |
|---|---|
| `harness.cjs` | Stubbed 2.5 scripting engine (fake clock, timers, connections, MIDI out, `engine.getSetting`), the real `common-controller-scripts.js` (auto-loaded like Mixxx) and the real `midi-components-0.0.js` from `vendor/`. `loadCandidate(dir)`, `env.init()`, `env.midiIn(status, midino, value)`, `env.advance(t)`, `env.shutdown()`. |
| `lib/xmlmap.cjs`, `lib/audit.cjs` | XML parser; control-name audit. |
| `cases/*.cjs` | The tests. `99_audit.cjs` runs last and audits every control name the other tests touched. |
| `controls-2.5.txt`, `tools/`, `AUDIT.md` | The 2.5.6 control list, how it is made, its gaps. |
| `fixtures/`, `vendor/` | Test inputs with SHA-256 (`fixtures/README.md`, `vendor/SOURCE.md`). |

The tests drive the T7's own MIDI addresses (hardware facts), not script function names.
