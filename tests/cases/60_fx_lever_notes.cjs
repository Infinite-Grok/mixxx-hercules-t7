'use strict';
// The FX lever sends one of four notes (0x55-0x58) depending on the T7's internal FX-button state
// (hardware capture 2026-10-04), on the button channel of its deck. Every one of them must work the same.
// Deck 1 = status 0x91, deck 2 = 0x92.
const DECKS = [
  {n: 1, btn: 0x91},
  {n: 2, btn: 0x92},
];
const unit = d => '[EffectRack1_EffectUnit' + d.n + ']';
const routing = d => 'group_[Channel' + d.n + ']_enable';

exports.register = t => {
  for (const d of DECKS) {
    for (const note of [0x55, 0x56, 0x57, 0x58]) {
      t.test('fx lever note 0x' + note.toString(16) + ' (deck ' + d.n + '): effect on while held, routing restored on release', 'core', h => {
        for (const prev of [0, 1]) {
          const env = h.load();
          env.init();
          env.set('[Channel1]', 'track_loaded', 1); env.set('[Channel2]', 'track_loaded', 1);
          env.set(unit(d), routing(d), prev);
          env.midiIn(d.btn, note, 127);
          h.eq(env.get(unit(d), 'enabled'), 1, 'unit on at 127 (previous routing ' + prev + ')');
          h.eq(env.get(unit(d), routing(d)), 1, 'routed to the deck at 127');
          env.midiIn(d.btn, note, 0);
          h.eq(env.get(unit(d), 'enabled'), 0, 'unit off at 0 (previous routing ' + prev + ')');
          h.eq(env.get(unit(d), routing(d)), prev, 'routing back to ' + prev);
        }
      });
    }
  }
};
