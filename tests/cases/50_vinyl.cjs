'use strict';
// Vinyl identity: the candidate (decoder + everything else loaded, other controls interleaved) must produce a
// byte-identical scratch2 / scratch2_enable trace to the reference decoder (fixtures/reference-decoder.js) running alone.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {createEnv} = require('../harness.cjs');

const FIX = path.join(__dirname, '..', 'fixtures');
const APPROVED_FILE = 'reference-decoder.js';
const APPROVED_SHA = '42befcc770494b33feb3a9786f5c91d9ebdade500027ab1c889c69357705bb9a';

/** Approved decoder alone, with the three bindings it needs (platter CC9, platter-time pitch bend, play). */
function referenceEnv(deck) {
  const env = createEnv();
  env.loadScripts([{filename: APPROVED_FILE, prefix: 'T7'}], FIX);
  const G = '[Channel' + deck + ']';
  env.bindings = [
    {status: 0xB0 | deck, midino: 9, script: true, key: 'T7.platter', group: G},
    {status: 0xE0 | deck, midino: 0, script: true, key: 'T7.platterTime', group: G},
    {status: 0x90 | deck, midino: 7, script: true, key: 'T7.play', group: G},
  ];
  return env;
}

// Events: {dt: ms since start, st, d1, d2}. Interleaved "other control" presses use the deck's own addresses.
const OTHER = deck => [
  [0x90 | deck, 9], [0x90 | deck, 16], [0x95 + deck, 0x11], [0xB0 | deck, 15], [0x90 | deck, 5], [0x90 | deck, 88],
];

function run(env, deck, events, withOthers) {
  const G = '[Channel' + deck + ']';
  env.init();
  env.set(G, 'track_loaded', 1); env.set(G, 'play', 1);
  const t0 = env.now;
  let i = 0;
  const others = OTHER(deck);
  for (const e of events) {
    env.advance(t0 + e.dt);
    env.midiIn(e.st, e.d1, e.d2);
    if (withOthers && i++ % 97 === 0) {
      const [st, n] = others[(i / 97 | 0) % others.length];
      env.midiIn(st, n, 127);
    }
  }
  env.advance(env.now + 3000);
  return env.writes.filter(w => w[0] === G && (w[1] === 'scratch2' || w[1] === 'scratch2_enable')).map(w => [w[3] - t0, w[1], w[2]]);
}

function deviceEvents(file, deck) {
  const d = JSON.parse(fs.readFileSync(path.join(FIX, 'recorded', file), 'utf8'));
  const ev = [];
  for (const r of d.reports) {
    ev.push({dt: r.tau + 20, st: 0xB0 | deck, d1: 9, d2: r.cc9});
    ev.push({dt: r.tau + 20, st: 0xE0 | deck, d1: r.pb & 127, d2: r.pb >> 7});
  }
  return ev;
}
function sessionEvents(file, deck) {
  const L = fs.readFileSync(path.join(FIX, 'recorded', file), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const t0 = L[0].wall_ns, ev = [];
  for (const e of L) {
    const r = e.raw, dt = Math.floor((e.wall_ns - t0) / 1e6);
    if ((r[0] & 0x0F) !== deck) continue;
    if ((r[0] & 0xF0) === 0xB0 && r[1] === 9) ev.push({dt, st: r[0], d1: 9, d2: r[2]});
    else if ((r[0] & 0xF0) === 0xE0) ev.push({dt, st: r[0], d1: r[1], d2: r[2]});
  }
  return ev;
}
function syntheticEvents(deck) {
  // Port of test_mapping.cjs platterStream: constant speed, slow, reverse, stop.
  const ev = []; let pos = 0, pb = 0, t = 0;
  const speeds = [];
  for (let i = 0; i < 3000; i++) speeds.push(i < 1500 ? 1 : (i < 2200 ? 0.1 : (i < 2600 ? -1 : 0)));
  for (const v of speeds) {
    if (v === 0) { t += 1; continue; }
    const dtMs = 0.8789 / Math.abs(v);
    t += dtMs;
    pos += v > 0 ? 1 : -1; pb = (pb + Math.round(dtMs * 2399.61)) % 16384;
    ev.push({dt: t, st: 0xB0 | deck, d1: 9, d2: ((pos % 128) + 128) % 128});
    ev.push({dt: t, st: 0xE0 | deck, d1: pb & 127, d2: pb >> 7});
  }
  return ev;
}

function identity(h, label, deck, events) {
  const ref = run(referenceEnv(deck), deck, events, false);
  const cand = run(h.load(), deck, events, true);
  h.ok(ref.length > 0, label + ': reference trace is not empty (' + ref.length + ' writes)');
  h.ok(cand.length === ref.length, label + ': same number of scratch2 writes (cand ' + cand.length + ', ref ' + ref.length + ')');
  const i = ref.findIndex((r, k) => JSON.stringify(r) !== JSON.stringify(cand[k]));
  h.ok(i < 0, label + ': identical trace (first difference at write ' + i + ': ref ' + JSON.stringify(ref[i]) + ' cand ' + JSON.stringify(cand[i]) + ')');
}

exports.register = t => {
  t.test('fixtures-intact: reference decoder and recorded streams match SHA256SUMS', 'core', h => {
    const lines = fs.readFileSync(path.join(FIX, 'SHA256SUMS'), 'utf8').trim().split('\n');
    for (const l of lines) {
      const [sha, name] = l.split(/\s+\*?/);
      const p = fs.existsSync(path.join(FIX, name)) ? path.join(FIX, name) : path.join(FIX, 'recorded', name);
      h.eq(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), sha, name + ' sha256');
    }
    h.ok(lines.some(l => l.startsWith(APPROVED_SHA)), 'reference decoder is pinned');
  });

  t.test('vinyl identity: synthetic platter stream (constant, slow, reverse, stop)', 'core', h => {
    identity(h, 'synthetic', 1, syntheticEvents(1));
  });

  for (const [name, deck] of [['left_1rev_cw', 1], ['left_1rev_ccw', 1], ['left_scratch', 1], ['right_1rev_cw', 2], ['m_pause', 1], ['m_playing_hold', 1], ['m_playing_nudge', 1], ['m_playing_scratch', 1]]) {
    t.test('vinyl identity: recorded device stream ' + name + ' (deck ' + deck + ')', 'core', h => {
      identity(h, name, deck, deviceEvents('device-' + name + '.json', deck));
    });
  }

  t.test('vinyl identity: 32 s of a recorded session platter log (deck 2)', 'core', h => {
    identity(h, 'device-session', 2, sessionEvents('device-session-first60k-platter.jsonl', 2));
  });
};
