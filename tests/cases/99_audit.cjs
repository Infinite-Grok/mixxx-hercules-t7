'use strict';
// Control-name audit. Runs LAST: it checks every [group],key the candidate's XML names plus every key the scripts
// touched at runtime (engine.getValue/setValue/getParameter/setParameter/makeConnection/trigger/softTakeover...)
// during ALL the tests above, against tests/controls-2.5.txt (see tests/AUDIT.md).
const audit = require('../lib/audit.cjs');

// Control names that exist only in newer Mixxx versions are NOT exempted: they must fail on 2.5.
exports.register = t => {
  const table = audit.load();

  t.test('audit: controls-2.5.txt is sane (size, known names present, known-bad names absent)', 'core', h => {
    h.ok(table.size > 500, 'control table has ' + table.size + ' entries');
    for (const [g, k] of [['[Channel1]', 'play'], ['[Channel1]', 'scratch2'], ['[Channel1]', 'hotcue_3_activate'], ['[Channel1]', 'beatloop_0.5_toggle'],
      ['[Channel1]', 'beatlooproll_0.0625_activate'], ['[Playlist]', 'SelectTrackKnob'], ['[Master]', 'crossfader'], ['[Sampler3]', 'cue_gotoandplay'],
      ['[EffectRack1_EffectUnit1]', 'group_[Channel1]_enable'], ['[EffectRack1_EffectUnit2_Effect3]', 'effect_selector'],
      ['[EqualizerRack1_[Channel1]_Effect1]', 'button_parameter1'], ['[QuickEffectRack1_[Channel1]]', 'super1'], ['[Mixer Profile]', 'xFaderCurve'],
      ['[Channel1]', 'CloneFromDeck'], ['[Channel1]', 'LoadSelectedTrack'], ['[Channel1]', 'slip_enabled'], ['[Channel1]', 'rate_dir']]) {
      const r = audit.check(table, g, k);
      h.ok(r.ok, 'known 2.5 control accepted: ' + g + ',' + k + ' (' + r.why + ')');
    }
    for (const [g, k] of [['[Channel1_Stem1]', 'mute'], ['[Channel1]', 'stem_count'], ['[Skin]', 't7_feedback'], ['[Channel1]', 'definitely_not_a_control'], ['[Channel1]', 'hotcue_x_activate'], ['[Master]', 'play']]) {
      h.ok(!audit.check(table, g, k).ok, 'known-bad name rejected: ' + g + ',' + k);
    }
  });

  t.test('audit: every [group],key in the XML and touched at runtime exists in Mixxx 2.5', 'core', h => {
    const env = h.load();
    const pairs = audit.xmlPairs(env.xml);
    for (const [id, r] of h.allSeen) {
      const [g, k] = id.split(String.fromCharCode(9));
      pairs.push([g, k, 'runtime ' + [...r.ops].join('/') + ' in "' + [...r.tests][0] + '"' + (r.tests.size > 1 ? ' (+' + (r.tests.size - 1) + ' more)' : '')]);
    }
    h.ok(h.allSeen.size > 50, 'the earlier tests touched ' + h.allSeen.size + ' distinct controls at runtime');
    const fails = audit.audit(table, pairs);
    h.eq(fails.length, 0, fails.length + ' control names not in Mixxx 2.5; see the list below');
    for (const f of fails) h.ok(false, 'NOT IN 2.5: ' + f.group + ',' + f.key + '  [' + f.where + '] ' + f.why);
  });
};
