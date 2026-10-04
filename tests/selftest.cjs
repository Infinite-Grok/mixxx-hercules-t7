'use strict';
// Negative controls: the harness must FAIL when the mapping is broken in a known way.
//   node tests/selftest.cjs [baselineCandidateDir]
// Each mutation copies the candidate to a temp dir, breaks one thing, runs the suite, and checks that the named
// tests (and only that kind of test) fail. A harness that cannot fail proves nothing.
const fs = require('fs');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const base = path.resolve(process.argv[2] || process.env.T7_CANDIDATE || path.join(__dirname, '..', 'res', 'controllers'));
const files = fs.readdirSync(base);
const find = suffix => files.find(f => f.endsWith(suffix));
const XML = find('.xml'), PLATTER = find('-platter.js'), SCRIPT = find('-script.js');

// Appends a wrapper around an existing function of the candidate: fn is the full name, body runs after the original.
const wrapAfter = (fn, body) => "\n" + fn + " = (function(o) { return function() { const r = o.apply(this, arguments); " + body + " return r; }; })(" + fn + ");\n";
const wrapBefore = (fn, body) => "\n" + fn + " = (function(o) { return function() { " + body + " return o.apply(this, arguments); }; })(" + fn + ");\n";

const MUTATIONS = [
  {name: 'decoder constant changed (VEL_SMOOTH 1.0 -> 0.5)', file: PLATTER, edit: s => s.replace('DJCiT7Platter.VEL_SMOOTH = 1.0;', 'DJCiT7Platter.VEL_SMOOTH = 0.5;'), expect: ['vinyl identity']},
  {name: 'timer left running by shutdown', file: SCRIPT, edit: s => s + wrapAfter('DJCiT7.shutdown', "engine.beginTimer(1000, function() { engine.setValue('[Channel1]', 'pfl', 1); });"), expect: ['R1:', 'R1b:']},
  {name: 'motor note sent from a page button', file: SCRIPT, edit: s => s + wrapBefore('DJCiT7.Deck.prototype.pageButton', 'midi.sendShortMsg(0x91, 0x7F, 0x7F);'), expect: ['motor safety']},
  {name: 'control that does not exist in 2.5 written by a pad', file: SCRIPT, edit: s => s + wrapBefore('DJCiT7.Deck.prototype.pad', "engine.setValue('[Channel1]', 'not_a_control', 1);"), expect: [], expectMsg: 'not_a_control'},
  {name: 'LED left lit after shutdown', file: SCRIPT, edit: s => s + wrapAfter('DJCiT7.shutdown', 'midi.sendShortMsg(0x91, 5, 0x7F);'), expect: ['shutdown clears every LED']},
  {name: 'knob-position request removed', file: SCRIPT, edit: s => s.replace('midi.sendShortMsg(0xB0, 0x7F, 0x7F);', ''), expect: ['init requests the knob positions']},
  {name: 'XML binding points at a missing function', file: XML, edit: s => s.replace('<key>DJCiT7.deck1.syncButton.input</key>', '<key>DJCiT7.deck1.syncButtonMissing.input</key>'), expect: ['every script-binding resolves']},
  {name: 'engine call that does not exist in 2.5 (engine.load)', file: SCRIPT, edit: s => s + wrapBefore('DJCiT7.Deck.prototype.pageButton', "engine.load('x.js');"), expect: ['every script binding runs']},
  {name: 'pad release ignores the pressed pad (stuck hot cue / roll)', file: SCRIPT, edit: s => s + '\nDJCiT7.Deck.prototype.releasePad = function() {};\n', expect: ['pads: release always matches']},
  {name: 'sampler pad loads the selected track like the stock SamplerButton', file: SCRIPT, edit: s => s.replace('        engine.setValue(this.group, "cue_gotoandplay", 1);', '        engine.setValue(this.group, "LoadSelectedTrack", 1);'), expect: ['sampler page 4:']},
  {name: 'sampler count raised at init instead of on demand', file: SCRIPT, edit: s => s.replace('DJCiT7.buildMixer();\n    DJCiT7.deck1.showPage(1);', 'DJCiT7.buildMixer();\n    engine.setValue("[App]", "num_samplers", 8);\n    DJCiT7.deck1.showPage(1);'), expect: ['sampler page 4:']},
  {name: 'sampler release does not stop (no hold-to-play)', file: SCRIPT, edit: s => s.replace('                engine.setValue(this.group, "cue_gotoandstop", 1);', '                engine.setValue(this.group, "play", 1);'), expect: ['sampler page 4:']},
  {name: 'deck release skips the held-action release (roll, sampler, FX left active at shutdown)', file: SCRIPT, edit: s => s.replace('    this.releaseHeld();\n', ''), expect: ['held release (shutdown, deck 1)', 'held release (init again, deck 2)']},
  {name: 'shifted PARAM bindings removed from the XML (nudge stranded by SHIFT)', file: XML, edit: s => s.replace(/ *<control>\n(?:(?!<\/control>)[^])*<\/control>\n/g, c => (/param(Up|Down)Button/.test(c) && /<status>0x9[45]<\/status>/.test(c) ? '' : c)), expect: ['PARAM + SHIFT (deck 1)', 'PARAM + SHIFT (deck 2)']},
  {name: 'padBase lamp removed', file: SCRIPT, edit: s => s.replace('midi.sendShortMsg(pads, deck.padBase + i, value);', ''), expect: ['pad lamp is also driven']},
];

let bad = 0;
const run = dir => {
  const out = path.join(dir, 'result.json');
  spawnSync(process.execPath, [path.join(__dirname, 'run.cjs'), dir, '--tag', 'core', '--json', out], {encoding: 'utf8', maxBuffer: 1 << 26});
  return JSON.parse(fs.readFileSync(out, 'utf8')).results;
};
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't7-selftest-'));
// Baseline for comparison: tests that already fail unmodified do not count as detections.
const baseDir = path.join(tmpRoot, 'base'); fs.mkdirSync(baseDir);
for (const f of files) fs.copyFileSync(path.join(base, f), path.join(baseDir, f));
const baseFail = new Set(run(baseDir).filter(r => !r.pass).map(r => r.name));
console.log('unmodified candidate: ' + baseFail.size + ' core tests already failing (ignored below)');
MUTATIONS.forEach((m, i) => {
  const d = path.join(tmpRoot, 'm' + i); fs.mkdirSync(d);
  for (const f of files) fs.copyFileSync(path.join(base, f), path.join(d, f));
  const before = fs.readFileSync(path.join(d, m.file), 'utf8'), after = m.edit(before);
  if (after === before) { console.log('SKIP  ' + m.name + ' (edit did not apply)'); bad++; return; }
  fs.writeFileSync(path.join(d, m.file), after);
  const res = run(d);
  const failed = res.filter(r => !r.pass && !baseFail.has(r.name)).map(r => r.name);
  // a test that already fails on the unmodified candidate is detected by a NEW failure message instead
  const msgHit = !m.expectMsg || res.some(r => r.fails.some(f => f.includes(m.expectMsg)));
  const ok = m.expect.every(e => failed.some(n => n.includes(e))) && msgHit;
  if (!ok) bad++;
  console.log((ok ? 'CAUGHT ' : 'MISSED ') + m.name + (m.expectMsg ? '  (message "' + m.expectMsg + '" ' + (msgHit ? 'reported' : 'NOT reported') + ')' : '') + '  -> failing: ' + (failed.length ? failed.map(n => n.slice(0, 40)).join(' | ') : 'none'));
});
fs.rmSync(tmpRoot, {recursive: true, force: true});
console.log(bad ? bad + ' mutation(s) not caught' : 'all ' + MUTATIONS.length + ' mutations caught');
process.exit(bad ? 1 : 0);
