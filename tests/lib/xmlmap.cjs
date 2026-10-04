'use strict';
// Minimal parser for a Mixxx MIDI mapping XML: scriptfiles, <control> bindings, <output> entries, settings.
// Regex based on purpose (the mapping XML is machine-written and regular); no dependencies.
const tag = (b, t) => { const m = b.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')); return m ? m[1].trim() : null; };
const num = s => (s === null ? null : parseInt(s, 16));

function parseXml(xml) {
  const files = [...xml.matchAll(/<file\s+([^>]*?)\/?>/g)].map(m => {
    const a = {}; for (const kv of m[1].matchAll(/(\w+)="([^"]*)"/g)) a[kv[1]] = kv[2];
    return {filename: a.filename, prefix: a.functionprefix || ''};
  });
  const controls = [...xml.matchAll(/<control>([\s\S]*?)<\/control>/g)].map(m => {
    const b = m[1];
    return {group: tag(b, 'group'), key: tag(b, 'key'), status: num(tag(b, 'status')), midino: num(tag(b, 'midino')),
      script: /<script-binding\s*\/>/.test(b), msb: /<fourteen-bit-msb\s*\/>/.test(b), lsb: /<fourteen-bit-lsb\s*\/>/.test(b),
      invert: /<invert\s*\/>/.test(b), softTakeover: /<soft-takeover\s*\/>/.test(b)};
  });
  const outputs = [...xml.matchAll(/<output>([\s\S]*?)<\/output>/g)].map(m => {
    const b = m[1];
    return {group: tag(b, 'group'), key: tag(b, 'key'), status: num(tag(b, 'status')), midino: num(tag(b, 'midino')),
      on: num(tag(b, 'on')), off: num(tag(b, 'off')), minimum: tag(b, 'minimum'), maximum: tag(b, 'maximum')};
  });
  // <settings><option variable="x" type="boolean" default="true"> ... (Mixxx 2.4+ controller settings)
  const settings = {};
  for (const m of xml.matchAll(/<option\s+([^>]*?)>([\s\S]*?)<\/option>|<option\s+([^>]*?)\/>/g)) {
    const attrs = m[1] || m[3], body = m[2] || '', a = {};
    for (const kv of attrs.matchAll(/(\w+)="([^"]*)"/g)) a[kv[1]] = kv[2];
    if (!a.variable) continue;
    let def = a.default;
    if (def === undefined) { const d = body.match(/<value\s+default="true"[^>]*>([\s\S]*?)<\/value>/); if (d) def = d[1].trim(); }
    settings[a.variable] = {type: a.type || 'string', default: def};
  }
  const info = {name: tag(xml, 'name'), author: tag(xml, 'author'), description: tag(xml, 'description')};
  return {info, files, controls, outputs, settings};
}
module.exports = {parseXml};
