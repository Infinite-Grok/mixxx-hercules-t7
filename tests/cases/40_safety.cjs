'use strict';
// Safety: motor addresses, knob-position request at init, LEDs cleared at shutdown.
const G = '[Channel1]', G2 = '[Channel2]';

// Motor address: note 0x7F on 0x91/0x92 (motor on/off) and CC 8 / CC 40 on 0xB1/0xB2 (motor speed).
const isMotorMsg = m => (((m[0] === 0x91 || m[0] === 0x92) && m[1] === 0x7F) || ((m[0] === 0xB1 || m[0] === 0xB2) && (m[1] === 8 || m[1] === 40)));

function drive(env) {
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  for (const b of env.bindings.filter(b => b.script)) {
    const vals = (b.status & 0xF0) === 0xB0 ? [1, 127, 64, 0] : [127, 0];
    for (const v of vals) { try { env.midiIn(b.status, b.midino, v); } catch (e) { /* reported by the binding test */ } }
  }
  env.set(G, 'play', 1); env.set(G2, 'play', 1); env.set(G, 'play', 0); env.set(G, 'rate', 0.05); env.set(G2, 'rate_ratio', 1.02);
  for (let i = 0; i < 200; i++) { env.advance(env.now + 7); env.midiIn(0xB1, 9, (i * 2) & 127); env.midiIn(0xE1, (i * 13) & 127, (i * 3) & 127); }
  env.advance(env.now + 5000);
}

exports.register = t => {
  t.test('motor safety: note 0x7F / CC8 / CC40 are sent only from motor code', 'core', h => {
    const env = h.load();
    env.init(); drive(env); env.shutdown(); env.advance(env.now + 2000);
    const motor = env.out.filter(o => isMotorMsg(o.msg));
    const bad = motor.filter(o => !o.motorCtx);
    h.eq(bad.slice(0, 3).map(o => o.msg), [], 'motor-address messages sent outside approved motor code (' + bad.length + ')');
    // Not vacuous: the instrumentation found the motor functions, or there were no motor messages at all.
    h.ok(motor.length === 0 || motor.some(o => o.motorCtx), 'motor messages exist (' + motor.length + ') and at least one came from instrumented motor code (harness option motorFns)');
  });

  t.test('motor safety: nothing in the control surface (buttons, pads, encoders, FX) causes a motor-address message', 'core', h => {
    const env = h.load();
    env.init();
    env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
    const n0 = env.out.length;
    for (const b of env.bindings.filter(b => b.script && !/platter|play/i.test(b.key))) {
      const vals = (b.status & 0xF0) === 0xB0 ? [1, 127, 64, 0] : [127, 0];
      for (const v of vals) { try { env.midiIn(b.status, b.midino, v); } catch (e) { /* binding test reports it */ } }
    }
    env.advance(env.now + 3000);
    const bad = env.out.slice(n0).filter(o => isMotorMsg(o.msg));
    h.eq(bad.slice(0, 3).map(o => o.msg), [], 'motor-address messages caused by non-platter, non-play bindings (' + bad.length + ')');
  });

  t.test('init requests the knob positions (0xB0 0x7F 0x7F)', 'core', h => {
    const env = h.load();
    env.init();
    h.ok(env.out.some(o => o.msg[0] === 0xB0 && o.msg[1] === 0x7F && o.msg[2] === 0x7F), 'init sends midi 0xB0 0x7F 0x7F');
  });

  t.test('shutdown clears every LED that was lit (note-on status 0x90-0x97, not the motor address)', 'core', h => {
    const env = h.load();
    env.init(); drive(env);
    // Light things up in a few more ways: hold FX paddle, pad modes, cue.
    env.midiIn(0x91, 88, 127); env.midiIn(0x91, 21, 127); env.midiIn(0x96, 0x63, 127); env.midiIn(0x91, 6, 127);
    env.set(G, 'play_indicator', 1); env.set(G, 'loop_enabled', 1);
    env.shutdown();
    const last = new Map();
    for (const o of env.out) {
      const [s, n, v] = o.msg;
      if (s >= 0x90 && s <= 0x97 && !(n === 0x7F && (s === 0x91 || s === 0x92))) last.set(s + ':' + n, v);
    }
    const lit = [...last].filter(([, v]) => v !== 0).map(([k, v]) => '0x' + Number(k.split(':')[0]).toString(16) + ' note ' + k.split(':')[1] + '=' + v);
    h.ok(last.size > 0, 'some LEDs were driven (' + last.size + ')');
    h.eq(lit, [], 'LEDs still lit after shutdown');
  });

  t.test('shutdown sends no more MIDI after its own LED clears (nothing re-lights)', 'core', h => {
    const env = h.load();
    env.init(); drive(env); env.shutdown();
    const n = env.out.length; env.advance(env.now + 5000);
    env.set(G, 'play_indicator', 1); env.set(G, 'rate', 0.2); env.set(G, 'beat_active', 1); env.set(G, 'loop_enabled', 1);
    h.eq(env.out.length, n, 'MIDI messages after shutdown when controls change');
  });
};
