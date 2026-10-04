'use strict';
// Offline harness for a Mixxx 2.5 controller mapping (XML + scripts). No Mixxx, no device.
//
//   const {loadCandidate} = require('./harness.cjs');
//   const env = loadCandidate('res/controllers', {settings: {...}});   // reads <scriptfiles> from the XML
//   env.init();                                  // like Mixxx: prefix.init(controllerName, debug) per prefix
//   env.midiIn(0x91, 0x06, 127);                 // routed through the XML binding table, like Mixxx
//   env.advance(env.now + 100);                  // fake clock; fires timers at their deadlines
//   env.shutdown();
//
// The engine stub follows the 2.5 scripting API (src/controllers/scripting/legacy/controllerscriptinterfacelegacy.h):
// calling an engine method that does not exist in 2.5 throws. The real midi-components-0.0.js and
// common-controller-scripts.js from the 2.5 tree are loaded from tests/vendor/ (see vendor/SOURCE.md).
//
// Derived from the author's earlier private test harness.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {parseXml} = require('./lib/xmlmap.cjs');

const VENDOR = path.join(__dirname, 'vendor');
const CONTROLLER_NAME = 'DJControl Inpulse T7';

// Methods of the 2.5 `engine` object (Q_INVOKABLE list, ControllerScriptInterfaceLegacy).
const ENGINE_API_2_5 = ['getSetting', 'getValue', 'setValue', 'getParameter', 'setParameter', 'getParameterForValue', 'reset',
  'getDefaultValue', 'getDefaultParameter', 'makeConnection', 'makeUnbufferedConnection', 'connectControl', 'trigger', 'log',
  'beginTimer', 'stopTimer', 'scratchEnable', 'scratchTick', 'scratchDisable', 'isScratching', 'softTakeover',
  'softTakeoverIgnoreNextValue', 'brake', 'spinback', 'softStart'];

// Default control values returned for controls nothing has written yet.
const DEFAULTS = {track_samplerate: 44100, rate_ratio: 1, beatloop_size: 4, rateRange: 0.08};

function resolveFile(dir, filename) {
  for (const base of [dir, VENDOR]) {
    const p = path.join(base, filename);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('script file not found (candidate dir or vendor): ' + filename);
}

/**
 * Create a stubbed Mixxx scripting environment.
 * opts.settings   : {name: value} returned by engine.getSetting
 * opts.motorFns   : script paths whose dynamic extent counts as "motor code" (default T7 motor senders)
 */
function createEnv(opts = {}) {
  let now = 1000;
  const vals = new Map(), conns = new Map(), timers = new Map();
  const out = [], sysex = [], writes = [], logs = [], calls = [];
  const seen = new Map();                 // "group\tkey" -> Set of operations
  const settings = Object.assign({}, opts.settings || {});
  const liveConns = new Set();
  let tid = 0, inMotor = 0;
  const scratching = new Set();

  const num = v => (typeof v === 'boolean' ? +v : v);   // Mixxx controls are doubles
  const see = (g, k, op) => {
    const id = g + '\t' + k;
    if (!seen.has(id)) seen.set(id, new Set());
    seen.get(id).add(op);
  };
  const get = (g, k) => (vals.has(g + k) ? vals.get(g + k) : (DEFAULTS[k] ?? 0));
  const set = (g, k, v, fire = true) => {
    const before = get(g, k);
    vals.set(g + k, v);
    writes.push([g, k, v, now]);
    if (fire && before !== v) for (const c of (conns.get(g + k) || []).slice()) c.cb(v, g, k);
  };
  const addConn = (g, k, cb) => {
    see(g, k, 'connect');
    const rec = {g, k, cb, live: true};
    const l = conns.get(g + k) || []; l.push(rec); conns.set(g + k, l);
    liveConns.add(rec);
    return {
      isConnected: true,
      disconnect() { rec.live = false; liveConns.delete(rec); const i = l.indexOf(rec); if (i >= 0) l.splice(i, 1); return true; },
      trigger() { cb(get(g, k), g, k); },
    };
  };
  const engineImpl = {
    getSetting: name => (name in settings ? settings[name] : undefined),
    getValue: (g, k) => { see(g, k, 'get'); return get(g, k); },
    setValue: (g, k, v) => { see(g, k, 'set'); set(g, k, num(v), true); },
    getParameter: (g, k) => { see(g, k, 'getParameter'); return get(g, k); },
    setParameter: (g, k, v) => { see(g, k, 'setParameter'); set(g, k, num(v), true); },
    getParameterForValue: (g, k, v) => { see(g, k, 'getParameterForValue'); return v; },
    reset: (g, k) => { see(g, k, 'reset'); set(g, k, DEFAULTS[k] ?? 0, true); },
    getDefaultValue: (g, k) => { see(g, k, 'getDefaultValue'); return DEFAULTS[k] ?? 0; },
    getDefaultParameter: (g, k) => { see(g, k, 'getDefaultParameter'); return DEFAULTS[k] ?? 0; },
    makeConnection: addConn,
    makeUnbufferedConnection: addConn,
    connectControl: (g, k, cb, disconnect) => { const c = addConn(g, k, cb); if (disconnect) c.disconnect(); return c; },
    trigger: (g, k) => { see(g, k, 'trigger'); for (const c of (conns.get(g + k) || []).slice()) c.cb(get(g, k), g, k); },
    log: msg => { logs.push(['engine.log', String(msg)]); },
    beginTimer(ms, cb, one) {
      if (typeof cb !== 'function') throw new Error('engine.beginTimer: callback must be a function (string code is not supported by this stub)');
      timers.set(++tid, {due: now + ms, ms, cb, one: !!one}); return tid;
    },
    stopTimer(id) { timers.delete(id); },
    scratchEnable(deck, ...r) { scratching.add(deck); calls.push(['scratchEnable', deck, ...r]); },
    scratchTick(deck, interval) { calls.push(['scratchTick', deck, interval]); },
    scratchDisable(deck, ramp) { scratching.delete(deck); calls.push(['scratchDisable', deck, ramp]); },
    isScratching: deck => scratching.has(deck),
    softTakeover(g, k, on) { see(g, k, 'softTakeover'); calls.push(['softTakeover', g, k, on]); },
    softTakeoverIgnoreNextValue(g, k) { see(g, k, 'softTakeoverIgnore'); calls.push(['softTakeoverIgnoreNextValue', g, k]); },
    brake(deck, ...r) { calls.push(['brake', deck, ...r]); },
    spinback(deck, ...r) { calls.push(['spinback', deck, ...r]); },
    softStart(deck, ...r) { calls.push(['softStart', deck, ...r]); },
  };
  const engine = new Proxy(engineImpl, {
    get(t, p) {
      if (typeof p === 'symbol' || p in t) return t[p];
      return () => { throw new Error('engine.' + String(p) + ' does not exist in the Mixxx 2.5 scripting API'); };
    },
  });
  const midi = {
    sendShortMsg(a, b, c) { out.push({msg: [a, b, c], motorCtx: inMotor > 0, t: now}); },
    sendSysexMsg(data, len) { sysex.push({data: Array.from(data), len}); },
    makeInputHandler() { throw new Error('midi.makeInputHandler is not supported by this stub'); },
  };
  const FakeDate = class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(Math.floor(now)); }
    static now() { return Math.floor(now); }
  };
  const con = {};
  for (const lvl of ['log', 'info', 'debug', 'warn', 'error']) con[lvl] = (...a) => { logs.push(['console.' + lvl, a.map(String).join(' ')]); };
  // Mixxx's ColorMapper (src/controllers/scripting/colormapper.cpp): the nearest available colour by the
  // "redmean" distance, ties going to the lowest colour value (QMap order); the strict < keeps the first.
  class ColorMapper {
    constructor(colors) { this.colors = Object.keys(colors).map(Number).sort((x, y) => x - y).map(k => [k, colors[k]]); }
    getNearestColor(c) {
      const r = x => (x >> 16) & 255, g = x => (x >> 8) & 255, b = x => x & 255;
      let best = null, bd = Infinity;
      for (const [k] of this.colors) {
        const mr = Math.trunc((r(c) + r(k)) / 2), dr = r(c) - r(k), dg = g(c) - g(k), db = b(c) - b(k);
        const d = Math.sqrt((((512 + mr) * dr * dr) >> 8) + 4 * dg * dg + (((767 - mr) * db * db) >> 8));
        if (d < bd) { bd = d; best = k; }
      }
      return best;
    }
    getValueForNearestColor(c) { const k = this.getNearestColor(c); const e = this.colors.find(x => x[0] === k); return e ? e[1] : undefined; }
  }
  const ctx = vm.createContext({engine, midi, Date: FakeDate, console: con, print: m => logs.push(['print', String(m)]), Math, isFinite, ColorMapper});

  const fire = t => {
    for (;;) {
      let nx = null;
      for (const [id, tm] of timers) if (tm.due <= t && (!nx || tm.due < nx[1].due)) nx = [id, tm];
      if (!nx) return;
      now = nx[1].due;
      if (nx[1].one) timers.delete(nx[0]); else nx[1].due += nx[1].ms;
      nx[1].cb();
    }
  };

  const env = {
    ctx, engine, midi, settings, out, sysex, writes, logs, calls, seen, get, set, fire,
    bindings: [], prefixes: [], files: [], info: null, xml: null,
    get timerCount() { return timers.size; },
    get liveConnectionCount() { return liveConns.size; },
    get now() { return now; },
    advance(t) { fire(t); now = Math.max(now, t); },
    run: code => vm.runInContext(code, ctx),
    /** Evaluate a dotted script path (works for const/let top-level bindings too). */
    resolvePath(p) {
      const parts = p.split('.');
      const parent = parts.length > 1 ? vm.runInContext(parts.slice(0, -1).join('.'), ctx) : null;
      const fn = vm.runInContext(p, ctx);
      return {fn, parent};
    },
    loadScripts(files, dir) {
      for (const f of files) {
        const p = f.vendor ? path.join(VENDOR, f.filename) : resolveFile(dir, f.filename);
        vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, {filename: p});
        env.files.push({filename: f.filename, path: p, prefix: f.prefix});
        if (f.prefix) env.prefixes.push(f.prefix);
      }
      for (const fnPath of opts.motorFns || (process.env.T7_MOTOR_FNS ? process.env.T7_MOTOR_FNS.split(',') : ['T7.setMotor', 'T7.setMotorSpeed', 'DJCiT7Platter.setMotor', 'DJCiT7Platter.setMotorSpeed'])) {
        try {
          const {fn, parent} = env.resolvePath(fnPath);
          if (typeof fn !== 'function') continue;
          const names = fnPath.split('.'); const last = names.pop();
          ctx.__wrap = function() { inMotor++; try { return fn.apply(this, arguments); } finally { inMotor--; } };
          vm.runInContext((names.length ? names.join('.') + '.' : 'this.') + last + ' = __wrap;', ctx);
          delete ctx.__wrap;
        } catch (e) { /* motor function not present in this candidate: fine */ }
      }
    },
    init() {
      for (const p of env.prefixes) {
        const {fn, parent} = env.resolvePath(p + '.init');
        if (typeof fn === 'function') fn.call(parent, CONTROLLER_NAME, false);
      }
    },
    shutdown() {
      for (const p of env.prefixes) {
        let r; try { r = env.resolvePath(p + '.shutdown'); } catch (e) { continue; }
        if (typeof r.fn === 'function') r.fn.call(r.parent);
      }
    },
    /** Deliver one MIDI message through the XML binding table, as Mixxx would. */
    midiIn(status, midino, value) {
      const isPB = (status & 0xF0) === 0xE0;
      const hits = env.bindings.filter(b => b.status === status && (isPB || b.midino === midino));
      let handled = 0;
      for (const b of hits) {
        if (b.script) {
          const {fn, parent} = env.resolvePath(b.key);
          if (typeof fn !== 'function') throw new Error('binding ' + b.key + ' is not a function');
          fn.call(parent, status & 0x0F, midino, value, status, b.group);
          handled++;
        } else if (b.msb) {
          env._msb = env._msb || new Map(); env._msb.set(b.group + b.key, value); handled++;
        } else if (b.lsb) {
          const msb = (env._msb || new Map()).get(b.group + b.key) ?? 0;
          let p = ((msb << 7) | value) / 16383; if (b.invert) p = 1 - p;
          see(b.group, b.key, 'midi-set'); set(b.group, b.key, p, true); handled++;
        } else {
          let p = value / 127; if (b.invert) p = 1 - p;
          see(b.group, b.key, 'midi-set'); set(b.group, b.key, p, true); handled++;
        }
      }
      return handled;
    },
    /** Last value of an outgoing short message with this status and byte1, or null. */
    lastOut(status, b1) {
      for (let i = out.length - 1; i >= 0; i--) { const m = out[i].msg; if (m[0] === status && m[1] === b1) return m[2]; }
      return null;
    },
  };
  return env;
}

/** Load a candidate directory (XML + the script files its <scriptfiles> list names). */
function loadCandidate(dir, opts = {}) {
  const xmlFile = fs.readdirSync(dir).filter(f => f.endsWith('.xml'));
  if (xmlFile.length !== 1) throw new Error('expected exactly one .xml in ' + dir + ', found ' + xmlFile.length);
  const xml = fs.readFileSync(path.join(dir, xmlFile[0]), 'utf8');
  const parsed = parseXml(xml);
  // Defaults from <settings>, overridden by opts.settings.
  const settings = {};
  for (const [k, v] of Object.entries(parsed.settings)) {
    if (v.default === undefined) continue;
    settings[k] = v.type === 'boolean' ? v.default === 'true' : (v.type === 'integer' || v.type === 'double' ? Number(v.default) : v.default);
  }
  const env = createEnv(Object.assign({}, opts, {settings: Object.assign(settings, opts.settings || {})}));
  env.xml = parsed; env.xmlFile = path.join(dir, xmlFile[0]); env.dir = dir;
  env.bindings = parsed.controls;
  // Mixxx 2.5 always loads common-controller-scripts.js first (REQUIRED_SCRIPT_FILE, legacycontrollermappingfilehandler.cpp).
  env.loadScripts([{filename: 'common-controller-scripts.js', prefix: '', vendor: true}, ...parsed.files], dir);
  return env;
}

module.exports = {createEnv, loadCandidate, ENGINE_API_2_5, CONTROLLER_NAME, VENDOR};
