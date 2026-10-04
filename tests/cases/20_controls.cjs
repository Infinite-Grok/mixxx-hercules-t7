'use strict';
// Observable behaviour of the control surface, driven by MIDI addresses of the T7 (hardware facts, not script internals).
// Deck 1 = status 0x91 (buttons) / 0xB1 (encoders) / 0x96 (pads, shifted buttons 0x94); deck 2 = 0x92 / 0xB2 / 0x97 / 0x95.
// Pad modes (0x91 notes): 15 hot cue, 16 loop, 17 stems, 18 sampler, 20 roll, 21 FX.
const G = '[Channel1]', G2 = '[Channel2]';
const U1 = '[EffectRack1_EffectUnit1]';
const E = (u, e) => '[EffectRack1_EffectUnit' + u + '_Effect' + e + ']';

function fresh(h, o) {
  const env = h.load(o);
  env.init();
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  const M = (st, n, v) => env.midiIn(st, n, v);
  const tap = (st, n) => { M(st, n, 127); M(st, n, 0); };
  return {env, M, tap, since: n => JSON.stringify(env.writes.slice(n).map(w => w.slice(0, 3)))};
}

exports.register = t => {
  t.test('buttons: CUE, SYNC, loop encoder, RANGE cycle', 'core', h => {
    const {env, M} = fresh(h);
    M(0x91, 6, 127); h.eq(env.get(G, 'cue_default'), 1, 'CUE press');
    M(0x91, 6, 0); h.eq(env.get(G, 'cue_default'), 0, 'CUE release');
    M(0x91, 5, 127); h.eq(env.get(G, 'sync_enabled'), 1, 'SYNC toggles on');
    M(0xB1, 14, 1); h.eq(env.get(G, 'beatloop_size'), 8, 'loop encoder doubles size');
    M(0xB1, 14, 127); h.eq(env.get(G, 'beatloop_size'), 4, 'loop encoder halves size');
    M(0x91, 82, 127); h.near(env.get(G, 'rateRange'), 0.16, 1e-9, 'RANGE 8% -> 16%');
    M(0x91, 82, 127); h.near(env.get(G, 'rateRange'), 0.5, 1e-9, 'RANGE 16% -> 50%');
    M(0x91, 82, 127); h.near(env.get(G, 'rateRange'), 0.08, 1e-9, 'RANGE wraps 50% -> 8%');
    M(0x94, 82, 127); h.eq(env.get(G, 'keylock'), 1, 'SHIFT+RANGE keylock');
  });

  t.test('buttons: PARAM nudge writes jog on the pressed deck only, held = repeats, release stops', 'core', h => {
    const {env, M} = fresh(h);
    const r0 = env.get(G, 'rate_ratio'), jogs = g => env.writes.filter(w => w[0] === g && w[1] === 'jog');
    let at = env.now; const n0 = jogs(G).length;
    M(0x91, 83, 127); h.near(env.get(G, 'jog'), 0.4, 1e-9, 'PARAM > writes jog +0.4');
    at += 100; env.advance(at); h.eq(jogs(G).length - n0, 6, 'PARAM > held keeps jogging every 20 ms');
    M(0x91, 83, 0); const n1 = jogs(G).length; at += 100; env.advance(at); h.eq(jogs(G).length, n1, 'release stops the nudge');
    M(0x91, 84, 127); h.near(env.get(G, 'jog'), -0.4, 1e-9, 'PARAM < writes jog -0.4');
    M(0x91, 84, 0); at += 100; env.advance(at);
    h.eq(env.get(G, 'rate_ratio'), r0, 'nudge leaves rate_ratio untouched');
    h.eq(jogs(G2).length, 0, 'nudge on deck 1 never touches deck 2');
    h.ok(env.get(G, 'beatjump_forward') !== 1 && env.get(G, 'beatjump_backward') !== 1, 'PARAM does not beat-jump');
  });

  t.test('browse: encoder writes SelectTrackKnob plainly, push loads the deck, shift scrolls 10', 'core', h => {
    const {env, M, since} = fresh(h);
    let n = env.writes.length; M(0xB1, 15, 1); M(0xB1, 15, 1);
    h.eq(since(n), JSON.stringify([['[Playlist]', 'SelectTrackKnob', 1], ['[Playlist]', 'SelectTrackKnob', 1]]), 'browse down twice = two plain +1 writes');
    n = env.writes.length; M(0xB1, 15, 127);
    h.eq(since(n), JSON.stringify([['[Playlist]', 'SelectTrackKnob', -1]]), 'browse up = one plain -1 write');
    n = env.writes.length; M(0x92, 13, 127); M(0x92, 13, 0);
    h.eq(since(n), JSON.stringify([['[Channel2]', 'LoadSelectedTrack', 1], ['[Channel2]', 'LoadSelectedTrack', 0]]), 'encoder push loads deck 2 (press 1, release 0)');
    n = env.writes.length; M(0xB4, 15, 1);
    h.eq(since(n), JSON.stringify([['[Playlist]', 'SelectTrackKnob', 10]]), 'SHIFT+browse scrolls 10');
    n = env.writes.length; M(0x94, 13, 127); M(0x94, 13, 0);
    h.eq(since(n), JSON.stringify([['[Channel1]', 'LoadSelectedTrack', 1], ['[Channel1]', 'LoadSelectedTrack', 0]]), 'SHIFT+push loads like the plain push');
  });

  t.test('pads: hot cue, loop, sampler, shifted loop controls', 'core', h => {
    const {env, M} = fresh(h);
    M(0x91, 15, 127); M(0x96, 0x00, 127); h.eq(env.get(G, 'hotcue_1_activate'), 1, 'HOT CUE pad 1'); M(0x96, 0x00, 0);
    M(0x91, 16, 127); M(0x96, 0x13, 127); h.eq(env.get(G, 'beatloop_2_toggle'), 1, 'LOOP pad 4 = 2 beats');
    env.set('[Sampler3]', 'track_loaded', 1);
    M(0x91, 18, 127); M(0x96, 0x32, 127); h.eq(env.get('[Sampler3]', 'cue_gotoandplay'), 1, 'SAMPLER pad 3 (loaded sampler plays from the start)');
    M(0x94, 44, 127); h.eq(env.get(G, 'loop_remove'), 1, 'SHIFT+AUTOLOOP push removes loop');
    M(0xB4, 14, 1); h.eq(env.get(G, 'beatjump_size'), 8, 'SHIFT+AUTOLOOP turn: beat-jump size');
    env.set(G, 'loop_enabled', 1); M(0xB4, 14, 127); h.eq(env.get(G, 'loop_move'), -1, 'SHIFT+AUTOLOOP turn moves an active loop');
  });

  t.test('pads: release always matches the press (mode change, SHIFT change, missed release)', 'core', h => {
    const {env, M} = fresh(h);
    const touched = (n, key) => env.writes.slice(n).some(w => w[1] === key);
    // P1a: ROLL held, mode changed to HOT CUE, release on the original note
    M(0x91, 20, 127); M(0x96, 0x50, 127); h.eq(env.get(G, 'beatlooproll_0.0625_activate'), 1, 'roll starts');
    M(0x91, 15, 127);
    let n = env.writes.length; M(0x96, 0x50, 0);
    h.eq(env.get(G, 'beatlooproll_0.0625_activate'), 0, 'P1a: roll ends on release after mode change');
    h.ok(!touched(n, 'hotcue_1_activate'), 'P1a: release does not touch hot cue 1');
    // P1a variant: release arrives on the new mode's note
    M(0x91, 20, 127); M(0x96, 0x50, 127); M(0x91, 15, 127); M(0x96, 0x00, 0);
    h.eq(env.get(G, 'beatlooproll_0.0625_activate'), 0, 'P1a: roll ends when the release comes on the new mode note');
    // P1b: hot cue held, SHIFT pressed, release
    M(0x96, 0x00, 127); h.eq(env.get(G, 'hotcue_1_activate'), 1, 'hot cue press');
    M(0x91, 4, 127);
    n = env.writes.length; M(0x96, 0x00, 0);
    h.eq(env.get(G, 'hotcue_1_activate'), 0, 'P1b: hot cue released after SHIFT change');
    h.ok(!touched(n, 'hotcue_1_clear'), 'P1b: release does not write hotcue_1_clear');
    // SHIFT + pad = clear; SHIFT let go before the pad: released as clear
    M(0x96, 0x08, 127); h.eq(env.get(G, 'hotcue_1_clear'), 1, 'SHIFT+pad = clear');
    M(0x91, 4, 0);
    n = env.writes.length; M(0x96, 0x08, 0);
    h.ok(env.get(G, 'hotcue_1_clear') === 0 && !touched(n, 'hotcue_1_activate'), 'clear released as clear');
    // LOOP mode SHIFT roll, SHIFT released first
    M(0x91, 16, 127); M(0x91, 4, 127); M(0x96, 0x18, 127);
    h.eq(env.get(G, 'beatlooproll_0.25_activate'), 1, 'LOOP + SHIFT pad 1 rolls 1/4');
    M(0x91, 4, 0); M(0x96, 0x18, 0);
    h.eq(env.get(G, 'beatlooproll_0.25_activate'), 0, 'LOOP roll ends although SHIFT was released first');
    // missed release: a second press first ends the previous action
    M(0x91, 20, 127); M(0x96, 0x51, 127); M(0x96, 0x51, 127); M(0x96, 0x51, 0);
    h.eq(env.get(G, 'beatlooproll_0.125_activate'), 0, 'double press then release leaves nothing held');
  });

  t.test('fx: paddle and FX-mode pad 4 share one momentary holder; slots arm; SHIFT selects; depth is 14 bit', 'core', h => {
    const {env, M} = fresh(h);
    h.eq(env.get(U1, 'enabled'), 0, 'unit 1 off at init');
    M(0x91, 88, 127); h.ok(env.get(U1, 'enabled') === 1 && env.get(E(1, 1), 'enabled') === 1, 'paddle with nothing armed: unit on + slot 1 armed');
    M(0x91, 88, 0); h.eq(env.get(U1, 'enabled'), 0, 'paddle release: unit off');
    M(0x90, 33, 127); h.eq(env.get(E(1, 2), 'enabled'), 1, 'FX button 2 arms unit 1 slot 2');
    h.eq(env.lastOut(0x90, 33), 0x7F, 'FX button 2 LED on');
    M(0x90, 36, 127); h.ok(env.get(E(2, 2), 'enabled') === 1 && env.get(E(1, 2), 'enabled') === 1, 'FX button 5 arms unit 2 slot 2');
    M(0x91, 4, 127); M(0x90, 34, 127);
    h.ok(env.get(E(1, 3), 'effect_selector') === 1 && env.get(E(1, 3), 'enabled') === 0, 'SHIFT+FX 3 = next effect, not arm'); M(0x91, 4, 0);
    M(0xB0, 12, 127); M(0xB0, 44, 127); h.eq(env.get('[EffectRack1_EffectUnit2]', 'super1'), 1, 'FX depth 14-bit');
    M(0x91, 88, 127); h.eq(env.get(U1, 'group_[Channel1]_enable'), 1, 'lever held: deck 1 routed to unit 1');
    M(0x91, 88, 0); h.eq(env.get(U1, 'group_[Channel1]_enable'), 0, 'lever released: previous routing (off) restored');
    env.set(U1, 'group_[Channel1]_enable', 1); M(0x91, 88, 127); M(0x91, 88, 0);
    h.eq(env.get(U1, 'group_[Channel1]_enable'), 1, 'lever released: previous routing (on) restored');
  });

  t.test('fx: FX-mode pad 4 is momentary and shares ownership with the paddle', 'core', h => {
    const {env, M} = fresh(h);
    M(0x91, 21, 127); M(0x96, 0x63, 127); h.eq(env.get(U1, 'enabled'), 1, 'FX pad 4 held: unit on');
    M(0x96, 0x63, 0); h.eq(env.get(U1, 'enabled'), 0, 'FX pad 4 released: unit off (no latch without paddle)');
    M(0x91, 88, 127); M(0x96, 0x63, 127); M(0x96, 0x63, 0);
    h.eq(env.get(U1, 'enabled'), 1, 'pad 4 tap while the paddle is held does not switch the unit off');
    M(0x96, 0x63, 127); M(0x91, 88, 0); h.eq(env.get(U1, 'enabled'), 1, 'paddle released while pad 4 held: unit stays on');
    M(0x96, 0x63, 0); h.eq(env.get(U1, 'enabled'), 0, 'last holder released: unit off');
    M(0x91, 85, 127); h.eq(env.get(U1, 'enabled'), 1, 'paddle on Note 85 = same momentary paddle');
    M(0x91, 85, 0); h.eq(env.get(U1, 'enabled'), 0, 'paddle Note 85 release');
  });

  t.test('crossfader: 14 bit, enable button, disabled gates every message, pickup without a jump', 'core', h => {
    const {env, M} = fresh(h);
    const XF = v14 => { M(0xB0, 0, v14 >> 7); M(0xB0, 32, v14 & 127); };
    const xf = () => env.get('[Master]', 'crossfader'), pos = v14 => v14 / 16383 * 2 - 1;
    XF(16383); h.near(xf(), 1, 1e-9, 'crossfader full right'); XF(0); h.near(xf(), -1, 1e-9, 'crossfader full left');
    XF(8192); h.near(xf(), 0, 1e-3, 'crossfader centre');
    M(0x90, 24, 0); h.eq(xf(), 0, 'disable centres the crossfader');
    XF(0); XF(3000); XF(16383); h.eq(xf(), 0, 'disabled: fader motion ignored on every 14-bit message');
    M(0x90, 24, 127); XF(16000); h.eq(xf(), 0, 're-enable with fader far right: no jump');
    XF(15000); h.eq(xf(), 0, 'still not picked up');
    XF(2000); h.near(xf(), pos(2000), 1e-9, 'fader crossing the centre is picked up');
    XF(1000); h.near(xf(), pos(1000), 1e-9, 'follows after pickup');
    M(0x90, 24, 0); M(0x90, 24, 127); XF(8300); h.near(xf(), pos(8300), 1e-9, 're-enable near the centre picks up at once');
  });

  t.test('crossfader curve switch goes through script.crossfaderCurve (writes [Mixer Profile])', 'core', h => {
    const {env, M} = fresh(h);
    const n = env.writes.length; M(0xB0, 11, 127); M(0xB0, 11, 0);
    h.ok(env.writes.slice(n).some(w => w[0] === '[Mixer Profile]'), 'curve switch writes [Mixer Profile] controls');
  });

  t.test('tempo fader: rate_dir is left to the user preference (never written)', 'core', h => {
    const {env, M} = fresh(h);
    M(0xB1, 8, 100); M(0xB1, 40, 3); M(0xB4, 8, 20); M(0xB4, 40, 1);
    env.advance(env.now + 10000);
    h.eq(env.writes.filter(w => w[1] === 'rate_dir').length, 0, 'no write to rate_dir after init, fader moves and 10 s');
    h.ok(env.get(G, 'rate') > 0, 'tempo fader writes rate');
  });

  t.test('LEDs: PLAY indicator lights note 7 on the deck channel', 'core', h => {
    const {env} = fresh(h);
    env.set(G, 'play_indicator', 1);
    h.ok(env.out.some(o => o.msg[0] === 0x91 && o.msg[1] === 7 && o.msg[2] === 0x7F), 'PLAY LED lights on 0x91 7');
  });
};
