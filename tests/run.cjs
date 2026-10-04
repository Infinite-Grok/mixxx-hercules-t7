'use strict';
// Test runner for the T7 / Mixxx 2.5 mapping harness.
//
//   node tests/run.cjs [candidateDir] [--json out.json] [--seen names.txt] [--only substring] [--list]
//
// candidateDir defaults to $T7_CANDIDATE, then to res/controllers of this repo.
// Every test is tagged 'core'; the exit code is 1 if any test fails.
// Tests are in tests/cases/*.cjs and export register(t); t.test(name, tag, fn(h)). A test reports ALL failed checks.
const fs = require('fs');
const path = require('path');
const {loadCandidate} = require('./harness.cjs');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const seenOut = opt('--seen', null), jsonOut = opt('--json', null), only = opt('--only', null), list = flag('--list');
const dir = path.resolve(args[0] || process.env.T7_CANDIDATE || path.join(__dirname, '..', 'res', 'controllers'));

const tests = [];
const reg = {test(name, tag, fn) { if (tag !== 'core') throw new Error('bad tag for ' + name); tests.push({name, tag, fn}); }};
const casesDir = path.join(__dirname, 'cases');
for (const f of fs.readdirSync(casesDir).filter(f => f.endsWith('.cjs')).sort()) require(path.join(casesDir, f)).register(reg);

const envs = [];
const allSeen = new Map();     // "group\tkey" -> {ops:Set, tests:Set}
let curTest = null;
const results = [];
let totalChecks = 0;

(async () => {
  for (const t of tests) {
    if (only && !t.name.includes(only)) continue;
    if (list) { console.log(t.tag.padEnd(7), t.name); continue; }
    const fails = []; let checks = 0; curTest = t.name;
    const h = {
      dir, allSeen,
      load(o) { const e = loadCandidate(dir, o); envs.push({e, test: t.name, tag: t.tag}); return e; },
      ok(c, msg) { checks++; if (!c) fails.push(msg); },
      eq(a, b, msg) { checks++; if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); },
      near(a, b, eps, msg) { checks++; if (!(Math.abs(a - b) <= eps)) fails.push(msg + ' (got ' + a + ', want ' + b + ')'); },
    };
    let error = null;
    try { await t.fn(h); } catch (e) { error = e; }
    // gather the control names this test touched, for the final audit
    for (const {e, test, tag} of envs.splice(0)) {
      for (const [id, ops] of e.seen) {
        const r = allSeen.get(id) || {ops: new Set(), tests: new Set(), tags: new Set()};
        ops.forEach(o => r.ops.add(o)); r.tests.add(test); r.tags.add(tag); allSeen.set(id, r);
      }
    }
    totalChecks += checks;
    const pass = !error && fails.length === 0;
    results.push({name: t.name, tag: t.tag, pass, checks, failed: fails.length, fails: fails.slice(0, 300), error: error ? String(error.stack || error).split('\n').slice(0, 4).join(' | ') : null});
    console.log((pass ? 'PASS ' : 'FAIL ') + t.tag.padEnd(7) + t.name + '  (' + checks + ' checks' + (pass ? '' : ', ' + fails.length + ' failed') + ')');
    if (!pass) { for (const f of fails.slice(0, +(process.env.T7_SHOW || 12))) console.log('       - ' + f); if (fails.length > +(process.env.T7_SHOW || 12)) console.log('       ... ' + (fails.length - +(process.env.T7_SHOW || 12)) + ' more (T7_SHOW=n to show more, --json for all)'); if (error) console.log('       ! ' + error.message); }
  }
  if (list) return;
  const sum = tag => { const r = results.filter(x => x.tag === tag); return {tests: r.length, passed: r.filter(x => x.pass).length, checks: r.reduce((a, x) => a + x.checks, 0), failedChecks: r.reduce((a, x) => a + x.failed, 0)}; };
  const summary = {candidate: dir, core: sum('core'), totalChecks};
  console.log('\n' + JSON.stringify(summary));
  if (seenOut) {
    const table = require('./lib/audit.cjs').load();
    const rows = [...allSeen].map(([id, r]) => { const [g, k] = id.split(String.fromCharCode(9)); const c = require('./lib/audit.cjs').check(table, g, k); return (c.ok ? 'ok   ' : 'FAIL ') + g + ',' + k + '  [' + [...r.ops].sort().join('/') + '; ' + [...r.tags].join('+') + ']' + (c.ok ? '' : '  ' + c.why); }).sort();
    fs.writeFileSync(seenOut, rows.join(String.fromCharCode(10)) + String.fromCharCode(10));
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({summary, results}, null, 1));
  process.exit(results.some(x => x.tag === 'core' && !x.pass) ? 1 : 0);
})();
