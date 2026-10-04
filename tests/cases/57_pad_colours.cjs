'use strict';
// Pad lamp colours: Hercules colour codes 0bRRGGGBB on every page, written at the pad note and at
// the SHIFT note (+ 8), a shared 250 ms blink timer, and the lifecycle rules for that timer.
const G = '[Channel1]', G2 = '[Channel2]';
const SAMPLER_COUNT = ['[App]', 'num_samplers'];

function fresh(h) {
  const env = h.load();
  env.init();
  env.set(G, 'track_loaded', 1); env.set(G2, 'track_loaded', 1);
  return {env, M: (st, n, v) => env.midiIn(st, n, v)};
}
const PAGE_BUTTON = page => 0x0E + page;             // 0x91 note that shows page 1..8
const show = (M, page, deck = 1) => M(0x90 + deck, PAGE_BUTTON(page), 127);
// Lamp of pad index i (0..7) of a page on deck 1, at the pad note and at the SHIFT note.
const lamp = (env, page, i) => env.lastOut(0x96, (page - 1) * 16 + i);
const lampShift = (env, page, i) => env.lastOut(0x96, (page - 1) * 16 + 8 + i);
const both = (h, env, page, i, want, msg) => {
  h.eq(lamp(env, page, i), want, msg + ' (pad note)');
  h.eq(lampShift(env, page, i), want, msg + ' (SHIFT note)');
};

exports.register = t => {
  t.test('pad colours: hot cue pad shows the cue colour, follows colour changes, clearing gives 0x00', 'core', h => {
    const {env} = fresh(h);
    both(h, env, 1, 0, 0x00, 'cue 1 not set');
    env.set(G, 'hotcue_1_color', 0xFF0000); env.set(G, 'hotcue_1_status', 1);
    both(h, env, 1, 0, 0x60, 'cue 1 set, red');
    env.set(G, 'hotcue_1_color', 0x00FF00);
    both(h, env, 1, 0, 0x1C, 'cue 1 colour changed to green');
    env.set(G, 'hotcue_1_color', 0xFF8800);
    both(h, env, 1, 0, 0x74, 'cue 1 colour changed to orange');
    env.set(G, 'hotcue_1_status', 0);
    both(h, env, 1, 0, 0x00, 'cue 1 cleared');
    env.set(G, 'hotcue_1_color', 0x0000FF);
    both(h, env, 1, 0, 0x00, 'colour change of a cue that is not set stays dark');
    env.set(G, 'hotcue_8_color', 0xFFFFFF); env.set(G, 'hotcue_8_status', 1);
    both(h, env, 1, 7, 0x7F, 'cue 8 set, white');
    // the Mixxx default palette has no exact entry; the nearest one is used
    env.set(G, 'hotcue_2_color', 0xC50A08); env.set(G, 'hotcue_2_status', 1);
    both(h, env, 1, 1, 0x60, 'Mixxx default red maps to the nearest, 0x60');
    env.set(G, 'hotcue_3_color', 0x32BE44); env.set(G, 'hotcue_3_status', 1);
    both(h, env, 1, 2, 0x30, 'Mixxx default green maps to the nearest, 0x30');
    // deck 2 has its own lamps
    env.set(G2, 'hotcue_1_color', 0x00FFFF); env.set(G2, 'hotcue_1_status', 1);
    h.eq(env.lastOut(0x97, 0x00), 0x1F, 'deck 2 cue 1 on 0x97');
    h.eq(env.lastOut(0x97, 0x08), 0x1F, 'deck 2 cue 1 on 0x97 SHIFT note');
    h.eq(lamp(env, 1, 0), 0x00, 'deck 1 cue 1 unaffected by deck 2');
  });

  t.test('pad colours: loop pad blinks 0x17 / 0x00 every 250 ms while its loop is active', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 2);
    for (let i = 0; i < 8; i++) both(h, env, 2, i, 0x00, 'loop pad ' + (i + 1) + ' idle');
    const timers0 = env.timerCount;
    env.set(G, 'beatloop_1_enabled', 1);                     // pad 3 = 1 beat
    const t0 = env.now;
    both(h, env, 2, 2, 0x17, 'phase 1: lit at once');
    h.eq(env.timerCount, timers0 + 1, 'one blink timer started');
    env.advance(t0 + 249); both(h, env, 2, 2, 0x17, 'still lit at +249 ms');
    env.advance(t0 + 250); both(h, env, 2, 2, 0x00, 'phase 2: dark at +250 ms');
    env.advance(t0 + 499); both(h, env, 2, 2, 0x00, 'still dark at +499 ms');
    env.advance(t0 + 500); both(h, env, 2, 2, 0x17, 'phase 3: lit at +500 ms');
    env.advance(t0 + 750); both(h, env, 2, 2, 0x00, 'dark at +750 ms');
    for (const i of [0, 1, 3, 4, 5, 6, 7]) both(h, env, 2, i, 0x00, 'other loop pad ' + (i + 1) + ' stays dark');
    env.set(G, 'beatloop_1_enabled', 0);
    both(h, env, 2, 2, 0x00, 'loop ended: dark');
    h.eq(env.timerCount, timers0, 'loop ended: blink timer stopped');
    const o = env.out.length; env.advance(env.now + 2000);
    h.eq(env.out.length, o, 'no MIDI after the blink ended');
    env.set(G, 'beatloop_1_enabled', 1);
    env.advance(env.now + 250); env.set(G, 'beatloop_1_enabled', 0);   // ended while dark
    both(h, env, 2, 2, 0x00, 'loop ended in the dark phase: dark');
    // the blink goes on while any pad needs it; two pads and two decks share one timer
    env.set(G, 'beatloop_1_enabled', 1); env.set(G, 'beatloop_4_enabled', 1);
    h.eq(env.timerCount, timers0 + 1, 'two blinking pads share one timer');
    env.set(G, 'beatloop_1_enabled', 0);
    h.eq(env.timerCount, timers0 + 1, 'timer keeps running while one pad still blinks');
    show(M, 2, 2); env.set(G2, 'beatloop_2_enabled', 1);
    h.eq(env.timerCount, timers0 + 1, 'deck 2 pad shares the same timer');
    h.ok([0x17, 0x00].includes(env.lastOut(0x97, 0x11)) && env.lastOut(0x97, 0x11) === env.lastOut(0x97, 0x19), 'deck 2 pad blinks on both layers');
    env.set(G, 'beatloop_4_enabled', 0); env.set(G2, 'beatloop_2_enabled', 0);
    h.eq(env.timerCount, timers0, 'all stopped: no timer');
  });

  t.test('pad colours: leaving the loop page stops its blink; coming back resumes it', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 2);
    const timers0 = env.timerCount;
    env.set(G, 'beatloop_2_enabled', 1);
    h.eq(env.timerCount, timers0 + 1, 'blinking');
    show(M, 1);
    h.eq(env.timerCount, timers0, 'page left: no timer');
    const o = env.out.length; env.advance(env.now + 1000);
    h.eq(env.out.length, o, 'page left: no MIDI');
    show(M, 2);
    h.eq(env.timerCount, timers0 + 1, 'page shown again: blinking again');
    both(h, env, 2, 3, 0x17, 'pad 4 (2 beats) lit at once on page show');
  });

  t.test('pad colours: sampler pad 0x63 loaded, blinks while playing, steady 0x63 when stopped, 0x00 when empty', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 4);
    env.set(SAMPLER_COUNT[0], SAMPLER_COUNT[1], 4);
    both(h, env, 4, 0, 0x00, 'empty sampler 1');
    env.set('[Sampler1]', 'track_loaded', 1);
    both(h, env, 4, 0, 0x63, 'loaded sampler 1');
    both(h, env, 4, 1, 0x00, 'empty sampler 2 stays dark');
    const timers0 = env.timerCount;
    env.set('[Sampler1]', 'play', 1);
    const t0 = env.now;
    both(h, env, 4, 0, 0x63, 'playing: lit at once');
    h.eq(env.timerCount, timers0 + 1, 'playing: blink timer');
    env.advance(t0 + 250); both(h, env, 4, 0, 0x00, 'playing: dark at +250 ms');
    env.advance(t0 + 500); both(h, env, 4, 0, 0x63, 'playing: lit at +500 ms');
    env.advance(t0 + 750); both(h, env, 4, 0, 0x00, 'playing: dark at +750 ms');
    env.set('[Sampler1]', 'play', 0);
    both(h, env, 4, 0, 0x63, 'stopped (in a dark phase): steady 0x63');
    h.eq(env.timerCount, timers0, 'stopped: timer stopped');
    const o = env.out.length; env.advance(env.now + 2000);
    h.eq(env.out.length, o, 'stopped: no MIDI');
    env.set('[Sampler1]', 'play', 1); env.set('[Sampler1]', 'track_loaded', 0);
    both(h, env, 4, 0, 0x00, 'ejected while playing: dark');
    h.eq(env.timerCount, timers0, 'ejected: timer stopped');
    env.set('[Sampler1]', 'play', 0);
    // a sampler that is playing when the page is shown blinks at once
    env.set('[Sampler2]', 'track_loaded', 1); env.set('[Sampler2]', 'play', 1);
    show(M, 1); show(M, 4);
    both(h, env, 4, 1, 0x63, 'sampler 2 playing when the page is shown: lit');
    h.eq(env.timerCount, timers0 + 1, 'sampler 2 blinking');
    env.set(SAMPLER_COUNT[0], SAMPLER_COUNT[1], 1);
    both(h, env, 4, 1, 0x00, 'sampler 2 removed: dark');
    h.eq(env.timerCount, timers0, 'sampler 2 removed: no timer');
  });

  t.test('pad colours: beat jump pads idle 0x10, held 0x1C, released 0x10 (also across a page change)', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 5);
    for (let i = 0; i < 8; i++) both(h, env, 5, i, 0x10, 'beat jump pad ' + (i + 1) + ' idle');
    M(0x96, 0x40, 127);
    both(h, env, 5, 0, 0x1C, 'pad 1 held');
    both(h, env, 5, 1, 0x10, 'pad 2 not held');
    M(0x96, 0x40, 0);
    both(h, env, 5, 0, 0x10, 'pad 1 released');
    M(0x96, 0x47, 127); both(h, env, 5, 7, 0x1C, 'pad 8 held');
    show(M, 6); M(0x96, 0x47, 0);                              // released after a page change
    both(h, env, 5, 7, 0x10, 'pad 8 released after a page change');
    show(M, 5); M(0x96, 0x42, 127); show(M, 6); show(M, 5);
    both(h, env, 5, 2, 0x1C, 'pad 3 still held when the page is shown again');
    M(0x96, 0x42, 0);
    both(h, env, 5, 2, 0x10, 'pad 3 released');
    // the SHIFT layer press lights the same pad
    M(0x96, 0x48 + 1, 127); both(h, env, 5, 1, 0x1C, 'SHIFT-layer press of pad 2 lights pad 2'); M(0x96, 0x48 + 1, 0);
    both(h, env, 5, 1, 0x10, 'and releases it');
  });

  t.test('pad colours: roll pads idle 0x00, 0x1F while the roll is active', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 6);
    for (let i = 0; i < 8; i++) both(h, env, 6, i, 0x00, 'roll pad ' + (i + 1) + ' idle');
    M(0x96, 0x52, 127);                                        // pad 3 = 1/4 beat
    h.eq(env.get(G, 'beatlooproll_0.25_activate'), 1, 'press starts the roll (control write unchanged)');
    env.set(G, 'beatloop_0.25_enabled', 1);                    // what Mixxx does while the roll runs
    both(h, env, 6, 2, 0x1F, 'roll pad 3 active');
    both(h, env, 6, 3, 0x00, 'roll pad 4 idle');
    M(0x96, 0x52, 0); env.set(G, 'beatloop_0.25_enabled', 0);
    both(h, env, 6, 2, 0x00, 'roll pad 3 released');
  });

  t.test('pad colours: FX pads 1-3 and 4: off 0x40, on 0x60; pads 5-8 0x00', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 7);
    for (let i = 0; i < 4; i++) both(h, env, 7, i, 0x40, 'FX pad ' + (i + 1) + ' off');
    for (let i = 4; i < 8; i++) both(h, env, 7, i, 0x00, 'FX pad ' + (i + 1) + ' dark');
    env.set('[EffectRack1_EffectUnit1_Effect2]', 'enabled', 1);
    both(h, env, 7, 1, 0x60, 'slot 2 on');
    both(h, env, 7, 0, 0x40, 'slot 1 still off');
    env.set('[EffectRack1_EffectUnit1_Effect2]', 'enabled', 0);
    both(h, env, 7, 1, 0x40, 'slot 2 off again');
    env.set('[EffectRack1_EffectUnit1]', 'enabled', 1);
    both(h, env, 7, 3, 0x60, 'unit on (pad 4)');
    env.set('[EffectRack1_EffectUnit1]', 'enabled', 0);
    both(h, env, 7, 3, 0x40, 'unit off (pad 4)');
    M(0x96, 0x63, 127);                                        // pad 4 held: the unit comes on
    both(h, env, 7, 3, 0x60, 'pad 4 held: unit on');
    M(0x96, 0x63, 0);
    both(h, env, 7, 3, 0x40, 'pad 4 released: unit off');
    for (let i = 4; i < 8; i++) both(h, env, 7, i, 0x00, 'FX pad ' + (i + 1) + ' still dark');
  });

  t.test('pad colours: key pads steady 0x52; page 3 stays dark', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 8);
    for (let i = 0; i < 8; i++) both(h, env, 8, i, 0x52, 'key pad ' + (i + 1));
    M(0x96, 0x70, 127); M(0x96, 0x70, 0);
    both(h, env, 8, 0, 0x52, 'key pad 1 after a press');
    show(M, 3);
    for (let i = 0; i < 8; i++) both(h, env, 3, i, 0x00, 'page 3 pad ' + (i + 1));
  });

  t.test('pad colours: a page switch writes the new page colours at once; both decks', 'core', h => {
    const {env, M} = fresh(h);
    env.set(G, 'hotcue_4_color', 0xFFFF00); env.set(G, 'hotcue_4_status', 1);
    env.set(G2, 'hotcue_5_color', 0xFF00FF); env.set(G2, 'hotcue_5_status', 1);
    show(M, 5); show(M, 5, 2);
    for (const [page, want] of [[5, 0x10], [8, 0x52], [7, 0x40]]) {
      for (const deck of [1, 2]) {
        const o = env.out.length;
        show(M, page, deck);
        const msgs = env.out.slice(o).map(x => x.msg);
        h.ok(msgs.some(m => m[0] === 0x95 + deck && m[1] === (page - 1) * 16 && m[2] === want), 'page ' + page + ' deck ' + deck + ': pad 1 written at once');
        h.ok(msgs.some(m => m[0] === 0x95 + deck && m[1] === (page - 1) * 16 + 8 && m[2] === want), 'page ' + page + ' deck ' + deck + ': SHIFT note written at once');
        h.eq(msgs.filter(m => m[0] === 0x95 + deck).length, 16, 'page ' + page + ' deck ' + deck + ': 8 pads x 2 notes');
      }
    }
    show(M, 1);
    h.eq(env.lastOut(0x96, 0x03), 0x7C, 'back on page 1 (deck 1): cue 4 yellow');
    show(M, 1, 2);
    h.eq(env.lastOut(0x97, 0x04), 0x42, 'back on page 1 (deck 2): cue 5 magenta');
  });

  t.test('pad colours: lifecycle: loop active then shutdown leaves 0 timers and no MIDI afterwards', 'core', h => {
    const {env, M} = fresh(h);
    const timers0 = env.timerCount;
    show(M, 2); show(M, 2, 2);
    env.set(G, 'beatloop_4_enabled', 1); env.set(G2, 'beatloop_1_enabled', 1);
    env.advance(env.now + 300);
    h.eq(env.timerCount, timers0 + 1, 'blinking on both decks with one timer');
    env.shutdown();
    h.eq(env.timerCount, 0, 'shutdown: 0 timers');
    h.eq(env.liveConnectionCount, 0, 'shutdown: 0 live connections');
    const o = env.out.length;
    env.advance(env.now + 5000);
    env.set(G, 'beatloop_4_enabled', 0); env.set(G, 'beatloop_4_enabled', 1); env.set(G2, 'beatloop_1_enabled', 0);
    env.advance(env.now + 5000);
    h.eq(env.out.length, o, 'no MIDI after shutdown');
  });

  t.test('pad colours: lifecycle: init is idempotent while pads blink; re-init after shutdown works', 'core', h => {
    const {env, M} = fresh(h);
    show(M, 2);
    env.set(G, 'beatloop_4_enabled', 1);
    env.init(); const t1 = env.timerCount, c1 = env.liveConnectionCount;
    env.init(); h.eq(env.timerCount, t1, 'timers after a second init'); h.eq(env.liveConnectionCount, c1, 'connections after a second init');
    // a fresh init shows page 1 and the loop (still active in Mixxx) is not on the shown page: no blink
    env.advance(env.now + 1000);
    const timersIdle = env.timerCount;
    env.midiIn(0x91, PAGE_BUTTON(2), 127);
    h.eq(env.timerCount, timersIdle + 1, 'after re-init the loop page blinks again with a single timer');
    env.shutdown(); env.init(); env.shutdown();
    h.eq(env.timerCount, 0, 'init, shutdown: 0 timers');
    const o = env.out.length; env.advance(env.now + 3000);
    h.eq(env.out.length, o, 'no MIDI afterwards');
  });

  t.test('pad colours: shutdown turns every pad lamp off on both layers (notes 0x00-0x0F + 16 x page, both decks)', 'core', h => {
    const {env, M} = fresh(h);
    env.set(G, 'hotcue_1_color', 0xFF0000); env.set(G, 'hotcue_1_status', 1);
    show(M, 2); env.set(G, 'beatloop_1_enabled', 1);
    show(M, 5); M(0x96, 0x40, 127);
    env.shutdown();
    for (const d of [1, 2]) {
      for (let page = 0; page < 8; page++) {
        for (let i = 0; i < 8; i++) {
          h.eq(env.lastOut(0x95 + d, page * 16 + i), 0x00, 'deck ' + d + ' pad note ' + (page * 16 + i));
          h.eq(env.lastOut(0x95 + d, page * 16 + 8 + i), 0x00, 'deck ' + d + ' SHIFT note ' + (page * 16 + 8 + i));
        }
      }
    }
  });

  t.test('pad colours: SHIFT layer: every pad lamp message comes in a pair (note, note + 8) with the same value', 'core', h => {
    const {env, M} = fresh(h);
    env.set(G, 'hotcue_1_color', 0x00FF00); env.set(G, 'hotcue_1_status', 1);
    for (let p = 1; p <= 8; p++) show(M, p);
    show(M, 2); env.set(G, 'beatloop_8_enabled', 1); env.advance(env.now + 600);
    const pad = env.out.map(o => o.msg).filter(m => m[0] === 0x96);
    h.ok(pad.length > 0, 'pad lamp messages exist (' + pad.length + ')');
    let unpaired = 0;
    for (let k = 0; k < pad.length; k += 2) {
      const a = pad[k], b = pad[k + 1];
      if (!b || (a[1] & 0x08) !== 0 || b[1] !== a[1] + 8 || a[2] !== b[2]) unpaired++;
    }
    h.eq(unpaired, 0, 'pairs (note, note + 8, same value)');
  });
};
