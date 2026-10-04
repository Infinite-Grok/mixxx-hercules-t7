'use strict';
// Browse-knob ring beat flash: 0x91 / 0x92 note 0x61, red 0x40 on beat 1
// of the bar (beats counted from the main cue point), blue 0x02 on beats 2-4, dark after 60 % of the beat period.
const G = '[Channel1]', G2 = '[Channel2]';
const RED = 0x40, BLUE = 0x02, OFF = 0x00;
const BEAT = 44100;                                  // engine samples per beat at 120 BPM, 44.1 kHz: 60/120 * 44100 * 2
const CUE = 5 * BEAT + 1234;                         // a cue that is not on a round number

// A playing deck with a grid of 120 BPM and a main cue.
function playing(h, opts = {}) {
  const env = h.load();
  env.init();
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  for (const g of [G, G2]) {
    env.set(g, 'file_bpm', opts.fileBpm ?? 120, false);
    env.set(g, 'bpm', opts.bpm ?? 120, false);
    env.set(g, 'track_samplerate', 44100, false);
    env.set(g, 'cue_point', opts.cue ?? CUE, false);
    env.set(g, 'play', 1);
  }
  return env;
}
// One beat: beat_closest is set first, then beat_active goes on and off, as the engine does.
function beat(env, g, index, cue = CUE) {
  env.set(g, 'beat_closest', cue + index * BEAT, false);
  env.set(g, 'beat_active', 1);
  env.set(g, 'beat_active', 0);
}
const ring = (env, deck = 1) => env.lastOut(0x90 + deck, 0x61);
const ringMsgs = (env, deck = 1) => env.out.filter(o => o.msg[0] === 0x90 + deck && o.msg[1] === 0x61).map(o => o.msg[2]);
// The colour a beat at this index (from the cue) shows right after it starts; then let the flash end.
const colourAt = (env, g, index, cue) => {
  env.set(g, 'beat_closest', (cue ?? CUE) + index * BEAT, false);
  env.set(g, 'beat_active', 1);
  const c = ring(env, g === G ? 1 : 2);
  env.set(g, 'beat_active', 0);
  env.advance(env.now + 2000);
  return c;
};

exports.register = t => {
  t.test('ring flash: beat 1 is red from the cue point, beats 2-4 blue, mathematical mod before the cue', 'core', h => {
    const env = playing(h);
    h.eq(colourAt(env, G, 0), RED, 'index 0 (the cue itself)');
    h.eq(colourAt(env, G, 1), BLUE, 'index 1');
    h.eq(colourAt(env, G, 2), BLUE, 'index 2');
    h.eq(colourAt(env, G, 3), BLUE, 'index 3');
    h.eq(colourAt(env, G, 4), RED, 'index 4');
    h.eq(colourAt(env, G, 5), BLUE, 'index 5');
    h.eq(colourAt(env, G, 8), RED, 'index 8');
    h.eq(colourAt(env, G, -1), BLUE, 'index -1');
    h.eq(colourAt(env, G, -3), BLUE, 'index -3');
    h.eq(colourAt(env, G, -4), RED, 'index -4');
    h.eq(colourAt(env, G, -8), RED, 'index -8');
    // a beat position a few samples off the exact multiple still rounds to the right beat
    env.set(G, 'beat_closest', CUE + 4 * BEAT + 300, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, 'index 4 plus 300 samples of rounding error');
  });

  t.test('ring flash: beat length follows file_bpm, track_samplerate and 2 channels', 'core', h => {
    const env = playing(h, {fileBpm: 90, bpm: 90});
    env.set(G, 'track_samplerate', 48000, false);
    const len = 60 / 90 * 48000 * 2;
    env.set(G, 'beat_closest', CUE + 4 * len, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, '4 beats of 90 BPM at 48 kHz from the cue');
    env.set(G, 'beat_active', 0); env.advance(env.now + 2000);
    env.set(G, 'beat_closest', CUE + 3 * len, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), BLUE, '3 beats from the cue');
    env.set(G, 'beat_active', 0); env.advance(env.now + 2000);
    // the same distance in 44.1 kHz / 120 BPM units is not 4 beats here: units matter
    env.set(G, 'beat_closest', CUE + 4 * BEAT, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), BLUE, '4 beats of the wrong unit is not beat 1');
  });

  for (const bpm of [120, 174]) {
    t.test('ring flash: dark after 60 % of the period at ' + bpm + ' BPM (just before / just after)', 'core', h => {
      const env = playing(h, {fileBpm: bpm, bpm});
      const lit = Math.round(60000 / bpm * 0.6);
      const t0 = env.now;
      env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
      h.eq(ring(env), RED, 'lit at once');
      env.advance(t0 + lit - 2); h.eq(ring(env), RED, 'still lit 2 ms before 60 %');
      env.advance(t0 + lit + 1); h.eq(ring(env), OFF, 'dark just after 60 %');
    });
  }

  t.test('ring flash: the period follows bpm (the effective tempo), not file_bpm', 'core', h => {
    const env = playing(h, {fileBpm: 120, bpm: 132});
    const lit = Math.round(60000 / 132 * 0.6);
    const t0 = env.now;
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    env.advance(t0 + lit - 2); h.eq(ring(env), RED, 'lit 2 ms before 60 % of the 132 BPM beat');
    env.advance(t0 + lit + 1); h.eq(ring(env), OFF, 'dark 1 ms after');
  });

  t.test('ring flash: no cue set (or invalid input) gives blue on every beat', 'core', h => {
    const env = playing(h, {cue: -1});
    for (const i of [0, 4, 8, -4]) h.eq(colourAt(env, G, i, -1), BLUE, 'no cue, beat ' + i);
    const e2 = playing(h);
    e2.set(G, 'file_bpm', 0, false); h.eq(colourAt(e2, G, 0), BLUE, 'file_bpm 0');
    e2.set(G, 'file_bpm', 120, false); e2.set(G, 'track_samplerate', 0, false); h.eq(colourAt(e2, G, 0), BLUE, 'samplerate 0');
    e2.set(G, 'track_samplerate', 44100, false); h.eq(colourAt(e2, G, 0), RED, 'valid again: red');
    e2.set(G, 'beat_closest', -1, false); e2.set(G, 'beat_active', 1); h.eq(ring(e2), BLUE, 'beat_closest invalid (-1)');
    e2.set(G, 'beat_active', 0);
    // no tempo from Mixxx: the flash still goes off
    const e3 = playing(h); e3.set(G, 'bpm', 0, false); e3.set(G, 'beat_closest', CUE, false); e3.set(G, 'beat_active', 1);
    h.eq(ring(e3), RED, 'bpm 0 still flashes'); e3.advance(e3.now + 301); h.eq(ring(e3), OFF, 'and goes dark (fallback 300 ms)');
    // a cue at position 0 is a real cue
    const e4 = playing(h, {cue: 0}); h.eq(colourAt(e4, G, 0, 0), RED, 'cue at 0, beat 0');
  });

  t.test('ring flash: a stopped deck stays dark; stopping while lit goes dark at once and stops the timer', 'core', h => {
    const env = playing(h);
    env.set(G, 'play', 0);
    beat(env, G, 0); beat(env, G, 1);
    h.eq(ringMsgs(env).length, 0, 'no ring message while not playing (' + ringMsgs(env) + ')');
    h.eq(env.timerCount, 0, 'no timer while not playing');
    env.set(G, 'play', 1);
    const timers0 = env.timerCount;
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, 'lit');
    h.eq(env.timerCount, timers0 + 1, 'one off timer');
    env.set(G, 'play', 0);
    h.eq(ring(env), OFF, 'play 0: dark at once');
    h.eq(env.timerCount, timers0, 'off timer stopped');
    const m = env.out.length; env.advance(env.now + 5000);
    h.eq(env.out.length, m, 'nothing more is sent');
    // eject while lit, then a new track while lit
    env.set(G, 'play', 1); env.set(G, 'beat_active', 0); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, 'lit again');
    env.set(G, 'track_loaded', 0);
    h.eq(ring(env), OFF, 'eject: dark at once');
    h.eq(env.timerCount, timers0, 'eject: timer stopped');
    env.set(G, 'track_loaded', 1); env.set(G, 'beat_active', 0); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, 'lit once more');
    env.set(G, 'track_loaded', 2);                   // another track loads
    h.eq(ring(env), OFF, 'new track: dark at once');
    h.eq(env.timerCount, timers0, 'new track: timer stopped');
  });

  t.test('ring flash: a new beat replaces the pending off timer (one timer per deck); reverse beats do not flash', 'core', h => {
    const env = playing(h);
    const base = env.timerCount;
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    env.advance(env.now + 100);
    env.set(G, 'beat_active', 0); env.set(G, 'beat_closest', CUE + BEAT, false); env.set(G, 'beat_active', 1);
    h.eq(env.timerCount, base + 1, 'still one timer');
    h.eq(ring(env), BLUE, 'second beat blue');
    env.advance(env.now + 299); h.eq(ring(env), BLUE, 'the first beat timer did not switch it off early');
    env.advance(env.now + 2); h.eq(ring(env), OFF, 'off 60 % after the second beat');
    h.eq(env.timerCount, base, 'no timer left');
    env.set(G, 'beat_active', 0);
    const n = ringMsgs(env).length;
    env.set(G, 'beat_active', 2);                    // reverse beat
    h.eq(ringMsgs(env).length, n, 'beat_active 2 (reverse) does not flash');
  });

  t.test('ring flash: deck 1 and deck 2 are independent and use their own channel', 'core', h => {
    const env = playing(h);
    env.set(G2, 'file_bpm', 150, false); env.set(G2, 'bpm', 150, false);
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env, 1), RED, 'deck 1 red on 0x91');
    h.eq(ring(env, 2), null, 'deck 2 untouched');
    const t0 = env.now;
    env.set(G2, 'beat_closest', CUE + 2 * (60 / 150 * 44100 * 2), false); env.set(G2, 'beat_active', 1);
    h.eq(ring(env, 2), BLUE, 'deck 2 blue on 0x92 (index 2 at 150 BPM)');
    h.eq(ring(env, 1), RED, 'deck 1 still lit');
    env.advance(t0 + 240 - 2); h.eq(ring(env, 2), BLUE, 'deck 2 lit 2 ms before 60 % of 150 BPM (240 ms)');
    h.eq(ring(env, 1), RED, 'deck 1 still lit at 238 ms (its own period is 300 ms)');
    env.advance(t0 + 240 + 1); h.eq(ring(env, 2), OFF, 'deck 2 dark after 240 ms');
    h.eq(ring(env, 1), RED, 'deck 1 still lit at 241 ms');
    env.advance(t0 + 301); h.eq(ring(env, 1), OFF, 'deck 1 off at its own 300 ms');
    // deck 2 stopping leaves deck 1 alone
    env.set(G, 'beat_active', 0); env.set(G, 'beat_active', 1);
    env.set(G2, 'beat_active', 0); env.set(G2, 'beat_active', 1); env.set(G2, 'play', 0);
    h.eq(ring(env, 1), RED, 'deck 1 stays lit when deck 2 stops');
    h.eq(ring(env, 2), OFF, 'deck 2 last ring message is off');
    h.eq(env.out.filter(o => o.msg[1] === 0x61 && o.msg[0] !== 0x91 && o.msg[0] !== 0x92).length, 0, 'no ring message on another status');
  });

  t.test('ring flash lifecycle: playing and lit, then shutdown: 0 timers and no MIDI out for 10 s', 'core', h => {
    const env = playing(h);
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    env.set(G2, 'beat_closest', CUE + BEAT, false); env.set(G2, 'beat_active', 1);
    h.eq(ring(env, 1), RED, 'lit before shutdown');
    env.shutdown();
    h.eq(ring(env, 1), OFF, 'deck 1 ring dark after shutdown');
    h.eq(ring(env, 2), OFF, 'deck 2 ring dark after shutdown');
    h.eq(env.timerCount, 0, 'no timers after shutdown');
    h.eq(env.liveConnectionCount, 0, 'no live connections after shutdown');
    const w = env.writes.length, o = env.out.length;
    env.advance(env.now + 10000);
    env.set(G, 'beat_active', 0); env.set(G, 'beat_active', 1);              // a late beat after shutdown
    env.advance(env.now + 10000);
    h.eq(env.out.length - o, 0, 'no MIDI out for 10 s after shutdown');
    h.eq(env.writes.length - w, 2, 'only the two writes the test made');
    h.eq(env.timerCount, 0, 'still no timers');
  });

  t.test('ring flash lifecycle: init twice keeps one connection set; re-init while lit turns the ring off', 'core', h => {
    const env = playing(h);
    const c1 = env.liveConnectionCount, t1 = env.timerCount;
    env.init(); h.eq(env.liveConnectionCount, c1, 'connections after a second init');
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 1);
    h.eq(ring(env), RED, 'lit');
    env.init();
    h.eq(ring(env), OFF, 're-init while lit: dark');
    h.eq(env.timerCount, t1, 'timers after re-init equal the idle count');
    const n = ringMsgs(env).length; env.advance(env.now + 5000);
    h.eq(ringMsgs(env).length, n, 'no late off message from a dead timer');
    env.set(G, 'beat_closest', CUE, false); env.set(G, 'beat_active', 0); env.set(G, 'beat_active', 1);
    h.eq(ringMsgs(env).length, n + 1, 'exactly one deck object answers a beat after re-init');
    env.shutdown();
  });
};
