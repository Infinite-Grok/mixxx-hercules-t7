'use strict';
// Held actions are released on shutdown and on re-init (init without shutdown), and a PARAM release that
// arrives on the SHIFT channel still ends the nudge. Driven by the T7's MIDI addresses; checks engine control values.
// Deck 1 = status 0x91 (buttons) / 0x94 (SHIFT layer) / 0x96 (pads); deck 2 = 0x92 / 0x95 / 0x97.
// Pad modes (note on the button channel): 18 sampler, 20 roll, 21 FX. FX lever = note 88.
const DECKS = [
  {n: 1, g: '[Channel1]', btn: 0x91, shf: 0x94, pad: 0x96},
  {n: 2, g: '[Channel2]', btn: 0x92, shf: 0x95, pad: 0x97},
];

function fresh(h) {
  const env = h.load();
  env.init();
  env.set('[Channel1]', 'track_loaded', 1); env.set('[Channel2]', 'track_loaded', 1);
  return {env, M: (st, n, v) => env.midiIn(st, n, v)};
}
const unit = d => '[EffectRack1_EffectUnit' + d.n + ']';
const routing = d => 'group_[Channel' + d.n + ']_enable';
const teardown = {
  shutdown: env => env.shutdown(),
  'init again': env => env.init(),
};

exports.register = t => {
  for (const [how, end] of Object.entries(teardown)) {
    for (const d of DECKS) {
      t.test('held release (' + how + ', deck ' + d.n + '): a held roll pad ends its roll', 'core', h => {
        const {env, M} = fresh(h);
        M(d.btn, 20, 127); M(d.pad, 0x50, 127);
        h.eq(env.get(d.g, 'beatlooproll_0.0625_activate'), 1, 'roll running while held');
        end(env);
        h.eq(env.get(d.g, 'beatlooproll_0.0625_activate'), 0, 'roll activate is 0 after ' + how);
      });

      t.test('held release (' + how + ', deck ' + d.n + '): a held sampler pad stops and returns to its cue', 'core', h => {
        const {env, M} = fresh(h);
        M(d.btn, 18, 127); M(d.pad, 0x32, 127);                 // sampler 3
        h.eq(env.get('[Sampler3]', 'cue_gotoandplay'), 1, 'sampler plays while held');
        const w = env.writes.length;
        end(env);
        h.eq(env.writes.slice(w).filter(x => x[0] === '[Sampler3]' && x[1] === 'cue_gotoandstop' && x[2] === 1).length, 1, 'cue_gotoandstop written once for the held sampler');
        h.eq(env.writes.slice(w).filter(x => x[1] === 'cue_gotoandplay').length, 0, 'no further play');
      });

      const holds = {
        'FX pad 4': (env, M) => { M(d.btn, 21, 127); M(d.pad, 0x63, 127); },
        'FX lever': (env, M) => { M(d.btn, 88, 127); },
        'FX pad 4 and lever': (env, M) => { M(d.btn, 88, 127); M(d.btn, 21, 127); M(d.pad, 0x63, 127); },
      };
      for (const [what, hold] of Object.entries(holds)) {
        t.test('held release (' + how + ', deck ' + d.n + '): ' + what + ' held puts unit and routing back', 'core', h => {
          for (const prev of [0, 1]) {
            const {env, M} = fresh(h);
            env.set(unit(d), routing(d), prev);
            hold(env, M);
            h.eq(env.get(unit(d), 'enabled'), 1, 'unit on while held (previous routing ' + prev + ')');
            h.eq(env.get(unit(d), routing(d)), 1, 'routed to the deck while held');
            end(env);
            h.eq(env.get(unit(d), 'enabled'), 0, 'unit off after ' + how + ' (previous routing ' + prev + ')');
            h.eq(env.get(unit(d), routing(d)), prev, 'routing back to ' + prev);
          }
        });
      }

      t.test('held release (' + how + ', deck ' + d.n + '): nothing held writes no pad or effect control; a second teardown is safe', 'core', h => {
        const {env, M} = fresh(h);
        M(d.btn, 20, 127); M(d.pad, 0x50, 127); M(d.pad, 0x50, 0);   // a pad pressed and released properly
        env.set(unit(d), routing(d), 1);
        const w = env.writes.length;
        end(env);
        const ctl = x => /^(beatlooproll_.*_activate|cue_gotoandstop|enabled|group_.*_enable)$/.test(x[1]);
        h.eq(env.writes.slice(w).filter(ctl).map(x => x.slice(0, 3)), [], 'no pad or effect control written for a deck with nothing held');
        h.eq(env.get(unit(d), routing(d)), 1, 'routing untouched');
        end(env);
        h.eq(env.writes.slice(w).filter(ctl).map(x => x.slice(0, 3)), [], 'second teardown writes none either');
      });
    }
  }

  t.test('held release: init -> init -> shutdown releases and leaves the state clean', 'core', h => {
    const {env, M} = fresh(h);
    env.set('[EffectRack1_EffectUnit1]', 'group_[Channel1]_enable', 0);
    M(0x91, 20, 127); M(0x96, 0x50, 127); M(0x91, 88, 127);
    env.init(); env.init(); env.shutdown();
    h.eq(env.get('[Channel1]', 'beatlooproll_0.0625_activate'), 0, 'roll off');
    h.eq(env.get('[EffectRack1_EffectUnit1]', 'enabled'), 0, 'unit off');
    h.eq(env.get('[EffectRack1_EffectUnit1]', 'group_[Channel1]_enable'), 0, 'routing restored');
  });

  for (const d of DECKS) {
    const jogs = env => env.writes.filter(w => w[0] === d.g && w[1] === 'jog');
    t.test('PARAM + SHIFT (deck ' + d.n + '): a release on the SHIFT channel ends the nudge', 'core', h => {
      for (const note of [0x53, 0x54]) {
        const {env, M} = fresh(h);
        M(d.btn, note, 127);                                    // PARAM down
        h.ok(jogs(env).length > 0, 'PARAM press writes jog');
        M(d.btn, 4, 127);                                       // SHIFT down
        M(d.shf, note, 0);                                      // PARAM release arrives on the SHIFT channel
        M(d.btn, 4, 0);                                         // SHIFT up
        const n = jogs(env).length;
        env.advance(env.now + 1000);
        h.eq(jogs(env).length, n, 'no jog writes for 1 s after the shifted release (note ' + note + ')');
        h.eq(env.timerCount, 0, 'no timer left running (note ' + note + ')');
        h.eq(env.get(d.g, 'rate_ratio'), 1, 'speed state not bent');
      }
    });

    t.test('PARAM + SHIFT (deck ' + d.n + '): a press while SHIFT is held does not nudge; a plain press still does', 'core', h => {
      const {env, M} = fresh(h);
      M(d.btn, 4, 127);
      M(d.shf, 0x53, 127); M(d.btn, 0x54, 127);
      env.advance(env.now + 1000);
      h.eq(jogs(env).length, 0, 'no jog writes from presses with SHIFT held');
      M(d.shf, 0x53, 0); M(d.btn, 0x54, 0); M(d.btn, 4, 0);
      M(d.btn, 0x53, 127);
      const n = jogs(env).length;
      h.ok(n > 0, 'plain press nudges');
      env.advance(env.now + 100);
      h.ok(jogs(env).length > n, 'plain press keeps nudging while held');
      M(d.btn, 0x53, 0);
      const k = jogs(env).length;
      env.advance(env.now + 1000);
      h.eq(jogs(env).length, k, 'plain release stops it');
    });
  }
};
