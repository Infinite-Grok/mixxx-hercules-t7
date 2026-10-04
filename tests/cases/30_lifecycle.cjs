'use strict';
// Lifecycle R1-R7: init / shutdown hygiene, observed through timers, connections, control writes and MIDI out only.
// Note: real Mixxx also stops script timers and connections when it shuts a mapping down; these tests are deliberately
// stricter (the mapping must clean up after itself), because the lifecycle fix was made for engine re-init paths.
const G = '[Channel1]', G2 = '[Channel2]';

function fresh(h) {
  const env = h.load();
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  return env;
}
// Number of writes + MIDI messages emitted while the clock runs for ms
const quiet = (env, ms) => { const w = env.writes.length, o = env.out.length; env.advance(env.now + ms); return env.writes.length - w + env.out.length - o; };
// Start things that need a timer: a held PARAM nudge, a held paddle, platter motion, a play press.
function busy(env) {
  env.midiIn(0x91, 83, 127);              // PARAM > held (nudge timer)
  env.midiIn(0x91, 88, 127);              // FX paddle held
  for (let i = 0; i < 20; i++) { env.advance(env.now + 5); env.midiIn(0xB1, 9, (i * 3) & 127); env.midiIn(0xE1, (i * 11) & 127, (i * 5) & 127); }
  env.set(G, 'play', 1);
  env.advance(env.now + 50);
}

exports.register = t => {
  t.test('R1: init, init, shutdown leaves 0 timers and 0 live connections', 'core', h => {
    const env = fresh(h);
    env.init(); env.init(); env.shutdown();
    h.eq(env.timerCount, 0, 'R1: timers after init,init,shutdown (live ' + env.timerCount + ')');
    h.eq(env.liveConnectionCount, 0, 'R1: live connections after shutdown (' + env.liveConnectionCount + ')');
  });

  t.test('R1b: no writes or MIDI for 10 s after shutdown, with held buttons and platter motion pending', 'core', h => {
    const env = fresh(h);
    env.init(); busy(env);
    env.shutdown();
    h.eq(quiet(env, 10000), 0, 'R1b: writes+MIDI in the 10 s after shutdown');
    h.eq(env.timerCount, 0, 'R1b: timers after shutdown with activity pending (' + env.timerCount + ')');
  });

  t.test('R2: PARAM held then shutdown: no jog writes afterwards', 'core', h => {
    const env = fresh(h);
    env.init(); env.midiIn(0x91, 83, 127); env.advance(env.now + 100);
    env.shutdown();
    const n = env.writes.filter(w => w[1] === 'jog').length; env.advance(env.now + 1000);
    h.eq(env.writes.filter(w => w[1] === 'jog').length, n, 'R2: jog writes after shutdown');
  });

  t.test('R5: second init leaves the same live timers and connections as the first (idempotent init)', 'core', h => {
    const env = fresh(h);
    const t0 = env.timerCount, c0 = env.liveConnectionCount;
    env.init(); const t1 = env.timerCount, c1 = env.liveConnectionCount;
    env.init(); const t2 = env.timerCount, c2 = env.liveConnectionCount;
    h.ok(t1 > t0 || c1 > c0, 'init registers timers or connections (' + t1 + ' timers, ' + c1 + ' connections)');
    h.eq(t2, t1, 'R5: timers after second init');
    h.eq(c2, c1, 'R5: connections after second init');
  });

  t.test('R5b: init, shutdown, init works again (re-init after shutdown)', 'core', h => {
    const env = fresh(h);
    env.init(); const t1 = env.timerCount, c1 = env.liveConnectionCount;
    env.shutdown(); env.init();
    h.eq(env.timerCount, t1, 'timers after re-init equal first init');
    h.eq(env.liveConnectionCount, c1, 'connections after re-init equal first init');
    env.shutdown();
  });
};
