'use strict';
// Scope decisions (sampler pages, headphone split, no motor setting) and the "no global side effects" rule.
const G = '[Channel1]', G2 = '[Channel2]';

function fresh(h) {
  const env = h.load();
  env.init();
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  return {env, M: (st, n, v) => env.midiIn(st, n, v)};
}

exports.register = t => {
  t.test('INSTRUMENTAL and VOCAL (plain and SHIFT, both decks) write nothing and stay dark', 'core', h => {
    const {env, M} = fresh(h);
    const w0 = env.writes.length, o0 = env.out.length;
    for (const st of [0x91, 0x92, 0x94, 0x95]) for (const n of [1, 2]) { M(st, n, 127); M(st, n, 0); }
    M(0x91, 4, 127);                                           // SHIFT flag held
    for (const st of [0x91, 0x92]) for (const n of [1, 2]) { M(st, n, 127); M(st, n, 0); }
    M(0x91, 4, 0);
    env.advance(env.now + 2000);
    h.eq(env.writes.slice(w0).map(w => w.slice(0, 3)), [], 'no control writes');
    h.eq(env.out.slice(o0).length, 0, 'no MIDI sent (lamps stay dark)');
    h.eq(env.bindings.filter(b => [1, 2].includes(b.midino) && [0x91, 0x92, 0x94, 0x95].includes(b.status)).length, 0, 'no XML binding at these addresses');
  });

  t.test('SHIFT + PARAM writes nothing; plain PARAM is ignored while SHIFT is held', 'core', h => {
    const {env, M} = fresh(h);
    const w0 = env.writes.length;
    for (const st of [0x94, 0x95]) for (const n of [83, 84]) { M(st, n, 127); M(st, n, 0); }
    M(0x91, 4, 127); M(0x91, 83, 127); M(0x91, 84, 127); M(0x91, 83, 0); M(0x91, 84, 0); M(0x91, 4, 0);
    env.advance(env.now + 1000);
    h.eq(env.writes.slice(w0).map(w => w.slice(0, 3)), [], 'no writes at all');
  });

  t.test('master headphone button toggles [Master] headSplit', 'core', h => {
    const {env, M} = fresh(h);
    M(0x90, 2, 127); M(0x90, 2, 0); h.eq(env.get('[Master]', 'headSplit'), 1, 'first press: split cue on');
    M(0x90, 2, 127); M(0x90, 2, 0); h.eq(env.get('[Master]', 'headSplit'), 0, 'second press: split cue off');
  });

  t.test('sampler page 4 keeps its on-demand behaviour: nothing at init, count raised on demand, play / go-to-and-stop', 'core', h => {
    const {env, M} = fresh(h);
    h.eq(env.writes.filter(w => w[0] === '[App]' && w[1] === 'num_samplers').length, 0, 'nothing written to num_samplers at init');
    M(0x91, 18, 127);                                          // page 4
    h.eq(env.lastOut(0x96, 0x36), 0, 'pad 7 lamp dark while sampler 7 does not exist');
    M(0x96, 0x36, 127);
    h.ok(env.get('[App]', 'num_samplers') >= 7, 'press raised num_samplers to >= 7 (' + env.get('[App]', 'num_samplers') + ')');
    h.eq(env.get('[Sampler7]', 'cue_gotoandplay'), 1, 'press writes cue_gotoandplay on [Sampler7]');
    const w1 = env.writes.length;
    M(0x96, 0x36, 0);
    h.eq(env.writes.length, w1, 'release writes nothing');
    env.set('[Sampler7]', 'track_loaded', 1);
    h.eq(env.lastOut(0x96, 0x36), 0x63, 'pad lamp lit (0x63) by [Sampler7] track_loaded once the sampler exists');
    env.set('[Sampler7]', 'track_loaded', 0);
    h.eq(env.lastOut(0x96, 0x36), 0, 'pad lamp off again when unloaded');
    M(0x96, 0x3E, 127); M(0x96, 0x3E, 0);                      // SHIFT layer of pad 7
    h.eq(env.get('[Sampler7]', 'cue_gotoandstop'), 1, 'SHIFT + press writes cue_gotoandstop');
    h.eq(env.writes.filter(w => w[0].startsWith("[Sampler") && (w[1] === 'LoadSelectedTrack' || w[1] === 'eject')).length, 0, 'never LoadSelectedTrack or eject');
    // a press on a pad below the current count does not lower or touch num_samplers
    const n = env.writes.filter(w => w[1] === 'num_samplers').length;
    M(0x96, 0x32, 127); M(0x96, 0x32, 0);
    h.eq(env.writes.filter(w => w[1] === 'num_samplers').length, n, 'pad 3 with 7 samplers: num_samplers not written again');
    h.eq(env.get('[Sampler3]', 'cue_gotoandplay'), 1, 'pad 3 plays [Sampler3]');
  });

  t.test('sampler pads connect to a sampler only once it exists; a larger sampler count lights the lamp', 'core', h => {
    const {env, M} = fresh(h);
    M(0x91, 17, 127);                                          // page 3 has no connections
    const conns0 = env.liveConnectionCount;
    M(0x91, 18, 127);                                          // page 4
    const shown = env.liveConnectionCount;
    env.set('[Sampler2]', 'track_loaded', 1);
    h.eq(env.lastOut(0x96, 0x31), 0, 'no lamp for a sampler that does not exist yet');
    env.set('[App]', 'num_samplers', 4);                       // the user (or skin) adds samplers
    h.eq(env.lastOut(0x96, 0x31), 0x63, 'pad 2 lamp lit for the loaded [Sampler2] once it exists');
    h.eq(env.liveConnectionCount, shown + 8, 'deck 1 pads 1-4 each add a track_loaded and a play connection (samplers 1-4)');
    M(0x91, 17, 127);                                          // leave page 4
    h.eq(env.liveConnectionCount, conns0, 'all page 4 connections dropped when the page is left');
    const o = env.out.length;
    env.set('[Sampler2]', 'track_loaded', 0);
    h.eq(env.out.length, o, 'no lamp traffic from a page that is not shown');
  });

  t.test('pad lamp is also driven at the pad-note base the hardware reported', 'core', h => {
    const {env, M} = fresh(h);
    M(0x96, 0x10, 127); M(0x96, 0x10, 0);                      // page 1, but the hardware reports base 0x10
    env.set(G, 'hotcue_1_color', 0xFF0000); env.set(G, 'hotcue_1_status', 1);
    h.eq(env.lastOut(0x96, 0x00), 0x60, 'lamp lit at the page own note');
    h.eq(env.lastOut(0x96, 0x10), 0x60, 'lamp also lit at the reported base');
    h.eq(env.lastOut(0x96, 0x18), 0x60, 'and at the SHIFT note of the reported base');
    env.set(G, 'hotcue_1_status', 0);
    h.eq(env.lastOut(0x96, 0x10), 0, 'and off again at the reported base');
    const {env: e2, M: M2} = fresh(h);
    M2(0x96, 0x00, 127); M2(0x96, 0x00, 0);                    // the expected base: no extra lamp
    e2.set(G, 'hotcue_1_status', 1);
    h.eq(e2.out.filter(o => o.msg[0] === 0x96 && o.msg[1] === 0x10).length, 0, 'no extra lamp when the base is the page own');
    const {env: e3, M: M3} = fresh(h);
    M3(0x96, 0x18, 127); M3(0x96, 0x18, 0);                    // a SHIFT-layer press does not change the base
    e3.set(G, 'hotcue_1_status', 1);
    h.eq(e3.out.filter(o => o.msg[0] === 0x96 && o.msg[1] === 0x10).length, 0, 'SHIFT presses do not set the base');
  });

  t.test('pad page 3 does nothing and stays dark; INSTRUMENTAL-style stems are gone', 'core', h => {
    const {env, M} = fresh(h);
    M(0x91, 17, 127);                                          // page 3
    for (let i = 0; i < 8; i++) h.eq(env.lastOut(0x96, 0x20 + i), 0, 'page 3 pad ' + (i + 1) + ' lamp is off');
    const w0 = env.writes.length;
    for (let n = 0x20; n < 0x30; n++) { M(0x96, n, 127); M(0x96, n, 0); }
    h.eq(env.writes.length, w0, 'page 3 pads write nothing');
  });

  t.test('no global side effects (rate_dir, effect state and routing, skin, decks 3/4, sampler volume)', 'core', h => {
    const env = h.load();
    env.init();
    h.eq(env.writes.filter(w => /^(rate_dir|enabled|group_.*_enable|effect_selector)$/.test(w[1])).length, 0, 'init writes no rate_dir, effect or routing control');
    h.eq(env.writes.filter(w => w[0].startsWith('[Skin]')).length, 0, 'init writes no skin control');
    env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
    for (const b of env.bindings.filter(b => b.script)) {
      const vals = (b.status & 0xF0) === 0xB0 ? [1, 127, 64, 0] : [127, 0];
      for (const v of vals) { try { env.midiIn(b.status, b.midino, v); } catch (e) { /* reported by the binding test */ } }
    }
    env.advance(env.now + 5000);
    const touched = new Set(env.writes.map(w => w[0] + ' ' + w[1]));
    const skin = [...touched].filter(k => k.startsWith('[Skin]'));
    h.eq(skin, ['[Skin] show_maximized_library'], 'the only skin write is the SHIFT+BACK toggle');
    h.eq(env.writes.filter(w => /^\[(Channel[34]|.*_Stem\d.*)/.test(w[0])).length, 0, 'no decks 3/4 and no stem groups');
    h.eq(env.writes.filter(w => w[1] === 'rate_dir').length, 0, 'rate_dir never written');
    env.shutdown();
    env.advance(env.now + 1000);
    h.eq(env.writes.filter(w => w[1] === 'rate_dir').length, 0, 'rate_dir not written at shutdown');
  });

  t.test('SHIFT+BACK toggles the large library view; BACK and ASSIST use the stock library controls', 'core', h => {
    const {env, M} = fresh(h);
    M(0x94, 0x51, 127); M(0x94, 0x51, 0); h.eq(env.get('[Skin]', 'show_maximized_library'), 1, 'SHIFT+BACK on');
    M(0x94, 0x51, 127); M(0x94, 0x51, 0); h.eq(env.get('[Skin]', 'show_maximized_library'), 0, 'SHIFT+BACK off');
    M(0x91, 0x51, 127); h.eq(env.get('[Library]', 'MoveFocusBackward'), 1, 'BACK');
    M(0x91, 0x50, 127); h.eq(env.get('[Library]', 'GoToItem'), 1, 'ASSIST');
    M(0x94, 0x50, 127); h.eq(env.get('[Library]', 'AutoDjAddBottom'), 1, 'SHIFT+ASSIST');
  });

  t.test('shutdown turns off the lamps and lights nothing else', 'core', h => {
    const {env, M} = fresh(h);
    env.set(G, 'play_indicator', 1); env.set(G, 'sync_enabled', 1); env.set(G, 'loop_enabled', 1); env.set(G, 'keylock', 1); env.set(G, 'pfl', 1);
    M(0x91, 16, 127); M(0x91, 6, 127);
    env.set('[EffectRack1_EffectUnit1_Effect1]', 'enabled', 1);
    env.shutdown();
    const off = (st, n) => env.lastOut(st, n) === 0;
    for (const d of [1, 2]) {
      for (const n of [1, 2, 5, 6, 7, 9, 10, 12, 82]) h.ok(off(0x90 + d, n) && off(0x93 + d, n), 'deck ' + d + ' note ' + n + ' off on both layers');
      for (let n = 0x0F; n <= 0x16; n++) h.ok(off(0x90 + d, n), 'deck ' + d + ' page lamp ' + n + ' off');
      for (let p = 0; p < 8; p++) for (let i = 0; i < 8; i++) h.ok(off(0x95 + d, p * 16 + i), 'deck ' + d + ' pad lamp ' + (p * 16 + i) + ' off');
      h.ok(off(0xB0 + d, 0x40), 'deck ' + d + ' level meter at 0');
    }
    for (let n = 0x20; n <= 0x25; n++) h.ok(off(0x90, n), 'FX lamp ' + n + ' off');
  });
};
