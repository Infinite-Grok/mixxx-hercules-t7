'use strict';
// Platter script: the motor is always on and platter lifecycle.
// Uses the minimal fixture XML (platter bindings only) and the real platter script from ../res/controllers.
const fs = require('fs');
const path = require('path');
const {createEnv} = require('../harness.cjs');
const {parseXml} = require('../lib/xmlmap.cjs');

const SCRIPT_DIR = path.join(__dirname, '..', '..', 'res', 'controllers');
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'platter-only.midi.xml');
const G = '[Channel1]';
const MOTOR_FNS = ['DJCiT7Platter.setMotor', 'DJCiT7Platter.setMotorSpeed'];

/** Load the platter script and fixture bindings. */
function load() {
  const parsed = parseXml(fs.readFileSync(FIXTURE, 'utf8'));
  const env = createEnv({motorFns: MOTOR_FNS});
  env.bindings = parsed.controls;
  env.loadScripts(parsed.files, SCRIPT_DIR);
  env.set(G, 'track_loaded', 1);
  return env;
}

/** Drive the platter of deck 1 at `speed` x nominal for `ms` milliseconds (CC9 tick + paired pitch bend). */
function drag(env, speed, ms, state) {
  const st = state || {pos: 0, pb: 0};
  const end = env.now + ms;
  let t = env.now;
  while (t < end) {
    const dt = 0.8789 / Math.abs(speed);
    t += dt;
    env.advance(t);
    st.pos += speed > 0 ? 1 : -1;
    st.pb = (st.pb + Math.round(dt * 2399.61)) % 16384;
    env.midiIn(0xB1, 9, ((st.pos % 128) + 128) % 128);
    env.midiIn(0xE1, st.pb & 127, st.pb >> 7);
  }
  return st;
}
const enabled = env => env.get(G, 'scratch2_enable');

exports.register = t => {
  t.test('motor: PLAY starts the motor and engages the vinyl; shutdown stops the motor', 'core', h => {
    const env = load();
    env.init(); env.midiIn(0x91, 7, 127);
    h.eq(env.lastOut(0x91, 0x7F), 127, 'motor note on after PLAY');
    h.eq(enabled(env), 1, 'scratch2_enable right after the motor starts (vinyl lags the motor)');
    h.ok(env.lastOut(0xB1, 8) !== null, 'motor speed CC 8 sent');
    env.shutdown();
    h.eq(env.lastOut(0x91, 0x7F), 0, 'motor note off at shutdown');
    h.eq(env.lastOut(0xB1, 8), 8192 >> 7, 'motor speed back to nominal (CC 8)');
    h.eq(env.lastOut(0xB1, 40), 0, 'motor speed back to nominal (CC 40)');
  });

  t.test('platter lifecycle: init, init, shutdown leaves 0 timers and 0 connections', 'core', h => {
    const env = load();
    env.init(); const c1 = env.liveConnectionCount; env.init();
    h.eq(env.liveConnectionCount, c1, 'second init does not add connections');
    drag(env, 1.3, 80); env.set(G, 'play', 1);
    env.init(); h.eq(env.liveConnectionCount, c1, 'init while busy does not add connections');
    env.shutdown();
    h.eq(env.timerCount, 0, 'timers after shutdown');
    h.eq(env.liveConnectionCount, 0, 'live connections after shutdown');
  });

  t.test('platter lifecycle: nothing written or sent for 10 s after shutdown', 'core', h => {
    const env = load();
    env.init(); env.set(G, 'play', 1); drag(env, 1.3, 120);
    env.shutdown();
    const n = env.out.length + env.writes.length;
    env.advance(env.now + 10000);
    h.eq(env.out.length + env.writes.length - n, 0, 'writes + MIDI after shutdown');
    env.init(); env.shutdown();
    h.eq(env.timerCount, 0, 're-init then shutdown leaves no timers');
  });
};
