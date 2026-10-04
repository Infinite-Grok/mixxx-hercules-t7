'use strict';
// XML binding table: every binding resolves, and every binding can be driven without throwing.
const audit = require('../lib/audit.cjs');

exports.register = t => {
  t.test('xml: scriptfiles resolve and the scripts load without errors', 'core', h => {
    const env = h.load();
    h.ok(env.xml.files.length > 0, 'XML lists at least one <file>');
    h.ok(env.files.every(f => require('fs').existsSync(f.path)), 'every listed script file exists');
    h.ok(env.xml.controls.length > 0, 'XML has <control> bindings (' + env.xml.controls.length + ')');
    env.init();
    h.eq(env.logs.filter(l => l[0] === 'console.error'), [], 'no console.error while loading and running init');
  });

  t.test('xml: every script-binding resolves to a function; every plain binding names a valid 2.5 control', 'core', h => {
    const env = h.load(), table = audit.load();
    env.init();   // bindings such as DJCiT7.deck1.syncButton.input exist only after init, as in Mixxx
    let nScript = 0, nPlain = 0;
    for (const b of env.bindings) {
      if (b.status === null || b.midino === null) { h.ok(false, 'binding with missing status/midino: ' + b.key); continue; }
      if (b.script) {
        nScript++;
        let r = null;
        try { r = env.resolvePath(b.key); } catch (e) { /* unresolved */ }
        h.ok(r && typeof r.fn === 'function', 'script-binding does not resolve to a function: ' + b.key);
      } else {
        nPlain++;
        const c = audit.check(table, b.group, b.key);
        h.ok(c.ok, 'plain binding is not a 2.5 control: ' + b.group + ',' + b.key + ' (' + c.why + ')');
      }
    }
    h.ok(nScript > 0, 'has script bindings (' + nScript + ' script, ' + nPlain + ' plain)');
  });

  t.test('xml: no two bindings share a status+midino unless they are the 14-bit pair or both script', 'core', h => {
    const env = h.load(), seen = new Map();
    for (const b of env.bindings) {
      const id = b.status + ':' + (((b.status & 0xF0) === 0xE0) ? 0 : b.midino);
      const prev = seen.get(id);
      // Mixxx calls all script bindings for one address; plain duplicates would double-write a control.
      if (prev && !(prev.script && b.script)) h.ok(false, 'ambiguous address 0x' + b.status.toString(16) + ' ' + b.midino + ': ' + prev.key + ' / ' + b.key);
      seen.set(id, b);
    }
    h.ok(true, 'checked ' + seen.size + ' addresses');
  });

  t.test('every script binding runs on press/release or encoder steps without throwing', 'core', h => {
    const env = h.load();
    env.init();
    env.set('[Channel1]', 'track_loaded', 1); env.set('[Channel2]', 'track_loaded', 1);
    let n = 0;
    for (const b of env.bindings.filter(b => b.script)) {
      const vals = (b.status & 0xF0) === 0xB0 ? [1, 127, 64, 0] : [127, 0];
      for (const v of vals) {
        try { env.midiIn(b.status, b.midino, v); n++; } catch (e) { h.ok(false, b.key + ' 0x' + b.status.toString(16) + ' ' + b.midino + ' v' + v + ': ' + e.message); }
      }
    }
    h.ok(n > 0, 'executed ' + n + ' binding calls');
    env.advance(env.now + 5000);
    env.shutdown();
    env.advance(env.now + 5000);
  });
};
