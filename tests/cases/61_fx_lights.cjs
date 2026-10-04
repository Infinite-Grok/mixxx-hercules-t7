'use strict';
// The T7 ignores host lamp messages for the six FX buttons (note-on 0x20-0x25) until the host sends a setup SysEx
// (measured on the USB wire from the T7's own host session, 2026-10-04). The mapping sends it at init ("on") and last at
// shutdown ("off"), and the lights must then follow the Mixxx effect slot `enabled` values.
const ON = [0xF0, 0x00, 0x01, 0x4E, 0x20, 0x02, 0x07, 0x7F, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0xF7];
const OFF = [0xF0, 0x00, 0x01, 0x4E, 0x20, 0x02, 0x07, 0x7F, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF7];
const slot = n => '[EffectRack1_EffectUnit' + (n <= 3 ? 1 : 2) + '_Effect' + ((n - 1) % 3 + 1) + ']';

exports.register = t => {
  t.test('fx lights: init sends the setup SysEx once, after B0 7F 7F, then the fx lamps show the slot states', 'core', h => {
    const env = h.load();
    env.set(slot(1), 'enabled', 1); env.set(slot(3), 'enabled', 1); env.set(slot(5), 'enabled', 1);
    env.out.length = 0; env.sysex.length = 0;
    env.init();
    h.eq(env.sysex.length, 1, 'one sysex at init');
    h.eq(JSON.stringify(env.sysex[0].data), JSON.stringify(ON), 'the "on" bytes');
    const knob = env.out.findIndex(o => o.msg[0] === 0xB0 && o.msg[1] === 0x7F && o.msg[2] === 0x7F);
    h.ok(knob >= 0 && env.sysex[0].after > knob, 'sysex comes after the knob request');
    const after = env.out.slice(env.sysex[0].after);
    const last = n => { for (let i = after.length - 1; i >= 0; i--) if (after[i].msg[0] === 0x90 && after[i].msg[1] === 0x1F + n) return after[i].msg[2]; return null; };
    const want = [127, 0, 127, 0, 127, 0];
    for (let n = 1; n <= 6; n++) h.eq(last(n), want[n - 1] ? 127 : 0, 'fx lamp ' + n + ' after the sysex');
  });

  t.test('fx lights: re-init sends the "on" message again (idempotent)', 'core', h => {
    const env = h.load();
    env.init(); env.init();
    h.eq(env.sysex.length, 2, 'one per init');
    h.eq(JSON.stringify(env.sysex[1].data), JSON.stringify(ON), 'same bytes');
  });

  t.test('fx lights: shutdown sends the "off" SysEx once, after the fx lamps are turned off', 'core', h => {
    const env = h.load();
    env.init();
    env.set(slot(2), 'enabled', 1);
    env.sysex.length = 0; env.out.length = 0;
    env.shutdown();
    h.eq(env.sysex.length, 1, 'one sysex at shutdown');
    h.eq(JSON.stringify(env.sysex[0].data), JSON.stringify(OFF), 'the "off" bytes');
    for (let n = 0x20; n <= 0x25; n++) {
      let idx = -1;
      env.out.forEach((o, i) => { if (o.msg[0] === 0x90 && o.msg[1] === n && o.msg[2] === 0) idx = i; });
      h.ok(idx >= 0 && idx < env.sysex[0].after, 'lamp 0x' + n.toString(16) + ' off before the sysex');
    }
  });

  t.test('fx lights: the lamp follows a slot changed from the screen', 'core', h => {
    const env = h.load();
    env.init();
    for (let n = 1; n <= 6; n++) {
      env.set(slot(n), 'enabled', 1);
      h.eq(env.lastOut(0x90, 0x1F + n), 127, 'slot ' + n + ' on');
      env.set(slot(n), 'enabled', 0);
      h.eq(env.lastOut(0x90, 0x1F + n), 0, 'slot ' + n + ' off');
    }
  });

  t.test('fx lights: pressing an fx button toggles the slot and the lamp matches', 'core', h => {
    const env = h.load();
    env.init();
    for (let n = 1; n <= 6; n++) {
      env.midiIn(0x90, 0x1F + n, 127); env.midiIn(0x90, 0x1F + n, 0);
      h.eq(env.get(slot(n), 'enabled'), 1, 'slot ' + n + ' armed');
      h.eq(env.lastOut(0x90, 0x1F + n), 127, 'lamp ' + n + ' on');
      env.midiIn(0x90, 0x1F + n, 127); env.midiIn(0x90, 0x1F + n, 0);
      h.eq(env.get(slot(n), 'enabled'), 0, 'slot ' + n + ' disarmed');
      h.eq(env.lastOut(0x90, 0x1F + n), 0, 'lamp ' + n + ' off');
    }
  });
};
