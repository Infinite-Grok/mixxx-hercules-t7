'use strict';
// Control-name audit against tests/controls-2.5.txt (generated from the Mixxx 2.5 sources, see AUDIT.md).
const fs = require('fs');
const path = require('path');

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Group template: "%N" = a channel number, or a whole group (for the Equalizer/QuickEffect rack groups).
const groupRe = t => new RegExp('^' + esc(t).replace(/%\d/g, '(?:\\d+|\\[[A-Za-z]+\\d*\\])') + '$');
const keyRe = t => new RegExp('^' + esc(t).replace(/%\d/g, '[0-9][0-9.]*') + '$');

const CHANNELISH = '(?:Channel|Sampler|PreviewDeck)\\d+';
const FAMILY_RES = {
  '@deck': [new RegExp('^\\[' + CHANNELISH + '\\]$')],
  '@vu': [new RegExp('^\\[' + CHANNELISH + '\\]$'), /^\[Master\]$/, /^\[Microphone\d*\]$/, /^\[Auxiliary\d+\]$/],
  '@effect': [
    /^\[EffectRack1(?:_EffectUnit\d+(?:_Effect\d+)?)?\]$/,
    /^\[(?:EqualizerRack1|QuickEffectRack1)_\[[A-Za-z]+\d*\](?:_Effect\d+)?\]$/,
    /^\[OutputEffectRack_\[Master\](?:_Effect\d+)?\]$/,
  ],
};

function load(file = path.join(__dirname, '..', 'controls-2.5.txt')) {
  const entries = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !/^[[@*]/.test(line)) continue;
    const [g, k, origin] = line.split('\t');
    if (g === '@unknown') continue;   // dynamic group of unknown family: ignored (a known gap, see AUDIT.md)
    let gres;
    if (g === '*') gres = null;
    else if (FAMILY_RES[g]) gres = FAMILY_RES[g];
    else gres = [groupRe(g)];
    entries.push({g, k, origin, gres, kre: keyRe(k)});
  }
  // every group shape known to 2.5, for entries whose group is '*'
  const known = [];
  for (const e of entries) if (e.gres) known.push(...e.gres);
  for (const e of entries) if (!e.gres) e.gres = known;
  const byKey = new Map();
  for (const e of entries) { const l = byKey.get(e.k) || []; l.push(e); byKey.set(e.k, l); }
  return {entries, size: entries.length};
}

/** {ok:boolean, why:string} for one [group],key. */
function check(table, group, key) {
  const keyHits = table.entries.filter(e => e.kre.test(key));
  if (!keyHits.length) return {ok: false, why: 'key not defined anywhere in 2.5'};
  if (keyHits.some(e => e.gres.some(r => r.test(group)))) return {ok: true, why: ''};
  return {ok: false, why: 'key exists in 2.5 but not for this group (key groups: ' + [...new Set(keyHits.map(e => e.g))].slice(0, 6).join(' ') + ')'};
}

/** Audit a list of [group, key] pairs; returns the failures as [{group,key,why,where}]. */
function audit(table, pairs) {
  const fails = [];
  const done = new Set();
  for (const [group, key, where] of pairs) {
    const id = group + '\t' + key;
    if (done.has(id)) continue;
    done.add(id);
    const r = check(table, group, key);
    if (!r.ok) fails.push({group, key, why: r.why, where});
  }
  return fails;
}

/** [group,key,where] pairs the XML itself names: non-script <control> bindings and every <output>. */
function xmlPairs(xml) {
  const pairs = [];
  for (const c of xml.controls) if (!c.script) pairs.push([c.group, c.key, 'xml control 0x' + c.status.toString(16) + ' ' + c.midino]);
  for (const o of xml.outputs) pairs.push([o.group, o.key, 'xml output']);
  return pairs;
}

module.exports = {load, check, audit, xmlPairs};
