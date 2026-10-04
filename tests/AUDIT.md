# Control-name audit: how `controls-2.5.txt` was made, and its gaps

Purpose: fail the build when the mapping reads, writes or connects a `[group],key` that does not exist in Mixxx 2.5.
Mixxx does not throw for an unknown control; `engine.getValue` returns 0 and logs a warning, so a typo or a 2.7-only name is silent.

## Source of the list
Mixxx **2.5.6**, taken from the `2.5.6` tag (commit `3ebac449e7e5`) with `git archive`.
The checkout is only read, never modified. Regenerate (Linux, macOS or WSL; needs Python 3) with:

    MIXXX_SRC=/path/to/mixxx-2.5 bash tests/tools/regen_controls.sh > tests/controls-2.5.txt

Two sources are merged (2044 entries: 760 from A, 1272 from B, 12 hand supplements):

* **A, `ConfigKey(group, key)` in `src/`** (tests excluded; `tools/extract_controls_2.5.py`). Every call is parsed with balanced
  parentheses. Literal groups and keys, `QString`/`QStringLiteral` wrappers, `QString("beatloop_%1_toggle").arg(..)` templates
  and named constants (`kAppGroup`, `EngineXfader::kXfaderConfigKey`, ...) are resolved. A variable group (`group`, `m_group`)
  takes a group *family* from the source path (`@deck` = `[ChannelN]`/`[SamplerN]`/`[PreviewDeckN]`, `@effect`, `@vu`, `[Master]`,
  `[MicrophoneN]`, `[AuxiliaryN]`). `%N` in a name is a number.
* **B, `src/test/co_dumps/co_dump_inital.csv`**: the 2.5 test suite's dump of every control that exists at runtime (4 decks, 64 samplers,
  effect units, equalizer and quick-effect racks, ...). Numbers in groups and keys are generalised (`hotcue_6_activate` to
  `hotcue_%1_activate`, `[Channel3]` to `[Channel%1]`; `scratch2` and `super1` stay literal). This is what resolves keys that A cannot
  (`group_[Channel1]_enable`, `hotcue_N_*`, effect parameters, `pitch_up`).

## How the audit uses it
`lib/audit.cjs`: a `[group],key` passes if some entry's key pattern and group pattern both match. `%N` in a key matches a number
(`hotcue_x_activate` fails). Names checked: every non-script `<control>` and every `<output>` in the XML, and every name the scripts
touch at runtime via `engine.getValue/setValue/getParameter/setParameter/makeConnection/makeUnbufferedConnection/connectControl/trigger/softTakeover*`
during all tests (the harness records them; `script.*` helpers from the real `common-controller-scripts.js` go through the same stub).
The stubbed `engine` object only has the methods of the 2.5 scripting API; any other call (for example `engine.load`) throws.
The audit runs last.

## Known gaps (read before trusting a PASS or a FAIL)
1. **Dynamic keys that A cannot resolve (43 calls, listed as `# DYNKEY` lines in the file header).** Mostly preferences/encoder
   settings (not controls); the control-relevant ones (effect parameter slots `parameterN`, `button_parameterN`, `group_X_enable`,
   hot cues) are covered by B.
2. **Dynamic group of unknown family (138 `ConfigKey` calls, 69 distinct entries marked `@unknown`).** Kept in the file for manual
   lookup but ignored by the audit. If a name fails only because of this, grep `controls-2.5.txt` for the key and check the source line.
3. **Group precision for A entries with family groups.** `@deck` accepts the key on any of `[ChannelN]`, `[SamplerN]`, `[PreviewDeckN]`
   even if 2.5 only creates it for some. B entries are exact per group. So a *wrong group for a real key* can pass (false pass); a *wrong key* cannot.
4. **B is a test dump of 4 decks.** It may lag the code (its last commit is Aug 2025); A covers new `ConfigKey` constructions.
5. **Controls that are not created by `ConfigKey`:** skin-defined `[Skin]` controls beyond the ones in the dump, controls created by
   another loaded mapping, and the `[Controller]`/engine-internal groups. A name that only a skin creates will fail here.
6. **The version is 2.5.6.** A name added to the 2.5 branch after 2.5.6 fails by design (a 2.5.6 install does not have it).
7. **Values are not audited.** Only names (and, for `%N`, the number shape). Ranges, types and `engine.setParameter` vs `setValue` semantics are not checked.
8. **Not audited:** the controller preferences XML, `<outputs>` `minimum/maximum`, and control names built from user settings at runtime that no test reaches.

The sanity test (`audit: controls-2.5.txt is sane`) pins 17 known-good and 6 known-bad names so a broken regeneration is noticed.
