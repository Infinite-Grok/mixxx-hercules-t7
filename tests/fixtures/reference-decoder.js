// Hercules DJControl Inpulse T7: experimental continuous vinyl transport.
// Reference decoder used by the vinyl identity test (tests/cases/50_vinyl.cjs): the platter drives the audio
// only while the vinyl is pushed off the motor's speed (held, slowed, scratched, spinning up or braking).
// While it rides the motor, scratch2 is released and the Mixxx engine plays: tempo, SYNC, nudge and
// keylock then work normally. The mapping's platter script must produce a byte-identical scratch2 /
// scratch2_enable trace to this decoder running alone.
// CC#9 is treated as a wrapping VINYL position, not motor-platter position.
// Silence cannot identify hand release. While a track is loaded, scratch remains
// enabled; Mixxx's audio-thread position controller settles at the fixed target.
// Releasing the vinyl resumes audio through new movement, not a release timer.
// 2048 ticks/rev and nominal 33 1/3 RPM remain provisional calibration constants.
// No touch classifier, pitch-bend timing reconstruction, or keylock claim is made.

// Motor speed target: outbound 14-bit CC8/40 on the deck channel, measured 2026-09-19
// by commanding values and reading back platter RPM from inbound CC#9:
//     value   7168   7680   8192   9216  10240  11264  12288  14336  16383
//     ratio  0.9375 0.9711 1.0000 1.0637 1.1259 1.1888 1.2507 1.3775 1.5014
// Fit: ratio = (value + 8192) / 16384, i.e. value = ratio * 16384 - 8192.
// Max error 0.25%, most points under 0.11%. 8192 is exactly nominal, full scale is +/-50%.
// This transfer function does NOT depend on the provisional 2048 ticks/rev: ticks/rev
// cancels in RPM(v)/RPM(8192), so it holds even while the calibration constant is open.
// Raw data: captures/t7-motorspeed-curve-20260919-174510.jsonl.
var T7 = {};
T7.INTERVALS_PER_REV = 2048;
T7.RPM = 33 + 1 / 3;
T7.MOTOR_NOTE = 127;
T7.MOTOR_CENTER = 8192;
T7.MOTOR_FULL_SCALE = 16384;
T7.MOTOR_MAX = 16383;
T7.connections = [];
T7.decks = {1: {lastPos: null}, 2: {lastPos: null}};

T7.group = function(deck) { return "[Channel" + deck + "]"; };
T7.deckFromGroup = function(group) {
    var m = /^\[Channel([12])\]$/.exec(group);
    return m ? Number(m[1]) : null;
};
T7.tickDelta = function(last, now) {
    var d = (now - last) & 127;
    // Exactly half a cycle has no recoverable direction.
    return d === 64 ? null : (d > 64 ? d - 128 : d);
};
T7.setMotor = function(deck, on) {
    if (T7.decks[deck]) { T7.decks[deck].motorOn = !!on; }
    midi.sendShortMsg(0x90 | deck, T7.MOTOR_NOTE, on ? 127 : 0);
};
// Drive the platter at the deck's tempo so the vinyl rides at the track's rate. Because
// scratch_position replaces playback speed rather than multiplying it, the tempo must be
// carried exactly once: it is applied here, to the motor, and not again in software.
T7.setMotorSpeed = function(deck, ratio) {
    if (!isFinite(ratio) || ratio <= 0) return;
    var v = Math.round(ratio * T7.MOTOR_FULL_SCALE - T7.MOTOR_CENTER);
    if (v < 0) v = 0;
    if (v > T7.MOTOR_MAX) v = T7.MOTOR_MAX;
    var s = T7.decks[deck];
    if (s.motorValue === v) return;   // suppress redundant traffic
    s.motorValue = v;
    midi.sendShortMsg(0xB0 | deck, 8, v >> 7);
    midi.sendShortMsg(0xB0 | deck, 40, v & 127);
};
// --- PitchBend edge timing -------------------------------------------------------------
// The T7 emits a PitchBend right after each CC#9 tick holding a ~2.4 MHz timestamp of that
// encoder edge. Measured over 1151 windows of a real session: rate reconstructed from the
// device clock has 0.18% CV, from message arrival 1.10% - the platter is steady and the
// jitter is USB/MIDI batching. Mixxx's PositionScratchController buckets position into
// 16 ms windows (it is designed for an 8 ms mouse), so a tick landing on the wrong side of
// a boundary moves derived rate several percent and is audible as wavering pitch.
//
// So position is extrapolated to "now" using a velocity measured on the device clock. All
// messages in one USB burst then resolve to nearly the same target instead of a staircase.
// This removes transport lag rather than adding any, which matters because added smoothing
// would trade the wavering complaint for a latency complaint.
//
// UNVERIFIED BY EAR. The diagnosis is measured; this correction is not yet confirmed to fix
// the audible waver. T7.PREDICT = false restores plain arrival-time behaviour for A/B.
T7.PB_HZ = 2400000;
T7.PB_WRAP = 16384;
T7.PREDICT = false;
T7.MAX_LEAD_S = 0.020;     // never predict further ahead than this

T7.pbDelta = function(last, now) {
    var d = (now - last) % T7.PB_WRAP;
    if (d < 0) { d += T7.PB_WRAP; }
    return d > T7.PB_WRAP / 2 ? d - T7.PB_WRAP : d;
};

// ============================================================================
// RATE MODE (profile-rate, 2026-09-21)
//
// Why: position mode publishes whole encoder ticks (0.879 ms of track time each) and
// PositionScratchController differentiates that on its 16 ms grid. Rounding at each end of a
// window is uniform over +/-0.5 tick, giving velocity noise sigma = 0.408 tick / 16 ms =
// 2.24% - about 12x the encoder's own 0.19% at the same timescale. Modelled with a PERFECT
// encoder the predicted wobble is unchanged, so encoder quality is not the issue and no
// amount of encoder handling fixes it. Position already updates every 0.879 ms, faster than
// any script timer could publish, so sub-tick interpolation cannot reduce the quantum either.
// The only remaining route is to stop differentiating position: compute velocity ourselves on
// the stable device clock and drive rate directly. In 2.5.6 ratecontrol uses scratch2
// verbatim as the playback rate when scratch2_enable is set (rate = scratchFactor), with no
// servo and no filter.
//
// Prediction under test: wobble should fall from ~30 cents toward the encoder's own ~3 cents.
//
// The four defects found in the earlier direct-rate experiment are addressed here:
//   1. Shortest-signed PB delta aliases sparse timing. PB is a monotonic timestamp that
//      advances even during reverse motion, so UNSIGNED FORWARD deltas are used, with an
//      explicit plausibility bound; implausible intervals update nothing.
//   2. Unload/reload retained velocity and PB state. All timing state is reset in one place
//      and cleared on track_loaded, scratch enable and shutdown.
//   3. samplePosition became NaN. It is initialised and never used in rate mode.
//   4. A 40 ms no-input timer permitted extra travel. Velocity DECAYS to zero instead, so a
//      still record goes silent; the timer can only stop audio, never start it, and there is
//      no release-to-play behaviour.
// ============================================================================
T7.MODE = "rate";
T7.NOMINAL_TPS = 2048 * (100 / 3) / 60;   // 1137.78 ticks/s at 1.0x
T7.PB_HZ = 2400000;
T7.PB_WRAP = 16384;
T7.PB_MAX_COUNTS = 12000;                 // ~5 ms: beyond this the interval is not trusted
// ANTI-ALIASING, not cosmetic smoothing. scratch2 is written at ~1137 Hz but Mixxx samples it
// once per audio buffer (1024 frames @ 44100 = 43 Hz), so anything above ~21 Hz folds down into
// the audible wobble band. Measured on the same run: encoder noise power sits at 30-60 Hz
// (48.7% of its energy) while the resulting audio wobble sits below 10 Hz (75% of its energy) -
// a spectrum inversion that can only be aliasing. alpha ~ 2*pi*fc/fs, so 0.05 puts the corner
// near 9 Hz, safely under the 21 Hz Nyquist of the control sampling. 0.30 put it near 54 Hz.
// (exp-pbwrap-20260921: the aliasing rationale above is unverified - opus-audit REVIEW.md s.5.
// VEL_SMOOTH is deliberately unchanged in this candidate.)
T7.VEL_SMOOTH = 1.0;   // v3-ns-deadline: only change from wrap-v3-deadline (c61463ad); alpha 1 = each observation published as measured
T7.DECAY_MS = 25;                         // cadence of the stop/decay check
T7.DECAY_FACTOR = 0.55;                   // velocity decay per tick of that timer
T7.RATE_EPSILON = 0.0015;                 // below this, publish exact zero

// PB is monotonic, so the forward difference is the true elapsed count - but it wraps every
// 16384/2.4e6 = 6.83 ms, so any slower interval loses whole wraps, and slow and reverse
// movement produce exactly those long intervals.
//
// WRAP RECOVERY (candidate, exp-pbwrap-20260921). The previous rule rounded the host arrival
// DIFFERENCE to whole wraps, so a delivery delay of only ~3.4 ms invented a wrap: one 2110-count
// tick read as 0.114x. Measured in Mixxx's own callbacks (5 runs), queue delay above its lower
// envelope is 1.7 ms median, 3-5 ms p99, up to 15 ms. No rule based on host time alone can
// recover a 6.83 ms wrap from that; this one uses the evidence that IS available:
//  1. Delivery can be late, never early. Each timestamp is placed on the device clock against
//     a lower envelope of (arrival - device time), and the LATEST consistent position is taken
//     (minimum queue delay). Correct whenever this message's delay above the envelope is under
//     WRAP_MS - ARRIVAL_EPS_MS (~5.8 ms); a delay alone, however large, can then only be read
//     as "that much earlier", not as extra time.
//  2. Past that, delay and a genuine extra wrap are indistinguishable per message. Compare the
//     host reading's span time with the time the current estimate predicts for the same ticks.
//     If the excess is j whole wraps (within HOLD_TOL_MS) and j wraps of extra delay stay
//     within QUEUE_MAX_MS, the interval is HELD: the current command stands, ticks stay
//     pending, and each later message (placed independently on the device clock) re-tests the
//     whole span. A real slowdown makes the excess grow with every tick and leaves the
//     tolerance within an edge or two, so it is then accepted as measured. A delivery backlog
//     keeps the excess at exactly j wraps, because the ticks behind it are still fast.
//     Continuity is evidence only while the current speed puts consecutive edges under half a
//     wrap apart (|speed| >= HOLD_MIN_TPS, ~0.26x); slower, the host placement alone decides.
//  3. A hold that collects HOLD_MIN_MSGS messages, all still exactly j wraps over, is
//     resolved as delivery delay (j wraps removed): that many fast ticks cannot sit behind a
//     real pause of j wraps. A hold older than HOLD_MAX_MS without that evidence takes the
//     host reading. Every held message re-arms the stop timer, so silence stops as usual.
// Not inferable from this input: a vinyl that paused for exactly j wrap periods and then
// resumed at the same speed looks identical to a backlog of j wraps; this rule then omits the
// pause (bounded by j * 6.83 ms of track time). Direction reversals are never held.
T7.WRAP_MS = T7.PB_WRAP / (T7.PB_HZ / 1000);   // 6.827 ms
T7.ARRIVAL_EPS_MS = 1.0;          // Date.now() is whole ms: an arrival can read up to 1 ms early
T7.QUEUE_MAX_MS = 16;             // largest delay believed possible; measured max 15.0 ms
T7.SEED_QUEUE_MS = 1.5;           // median measured delay, so a one-message seed is unbiased
T7.OFFSET_LEAK_MS_PER_S = 0.25;   // envelope may rise this fast: device clock ran -160 ppm
T7.OFFSET_RESEED_MS = 10000;      // after this much silence, leak error could exceed EPS
// Backlog excess matched j wraps to <= 0.012 ms in 216 real holds (device timestamps are exact
// and the speed behind a backlog is unchanged); real hand motion coincided at >= 0.29 ms.
T7.HOLD_TOL_MS = 0.1;             // plus HOLD_TOL_FRAC of the predicted span time
T7.HOLD_TOL_FRAC = 0.005;
T7.HOLD_MIN_TPS = 2 * T7.PB_HZ / T7.PB_WRAP;   // 293 ticks/s = 0.26x: edges <= half a wrap apart
T7.HOLD_MIN_MSGS = 8;
T7.HOLD_MAX_MS = 20;              // exceeds the longest measured delivery stall
T7.FRESH_MS = 50;                 // older estimates are not continuity evidence
// ---- wrap-v2 (exp-stopsafe-wrap2): regime selection between the v1 engine and the original rule.
// Below the fast regime every interval may span a wrap; there the v1 envelope has no continuity
// protection and its misreads come in correlated pairs, while the original rule has no estimated
// baseline to go stale. Neither rule can recover the wrap count there once delivery delay
// exceeds about half a wrap (original) or ~5.8 ms (v1): that ambiguity is NOT resolved, and the
// original rule's behaviour is kept rather than replaced by a different unresolved one.
T7.V1_SEASON = 32;                // v1 placements since its seed before its reading is published
// The original rule, verbatim from the reviewed mapping (sha 2149c45d...).
T7.pbForward = function(last, now, elapsedMs) {
    var d = (now - last) % T7.PB_WRAP;
    if (d < 0) { d += T7.PB_WRAP; }
    if (elapsedMs > 0) {
        var expected = elapsedMs * (T7.PB_HZ / 1000);
        var wraps = Math.round((expected - d) / T7.PB_WRAP);
        if (wraps > 0) { d += wraps * T7.PB_WRAP; }
    }
    return d;
};

T7.TRACE_SINK = null;             // instrumentation; no effect unless installed
T7.trace = function(rec) { if (T7.TRACE_SINK) { T7.TRACE_SINK(rec); } };

// Places timestamp pbNow, arriving at nowMs, on the unwrapped device count.
T7.pbPlace = function(s, pbNow, nowMs) {
    var perMs = T7.PB_HZ / 1000;
    if (s.offsetMs === null || nowMs - s.offsetAtMs > T7.OFFSET_RESEED_MS) {
        s.offsetMs = nowMs - pbNow / perMs - T7.SEED_QUEUE_MS;
        s.pbU = null;   // a new envelope frame: the next placement seeds rather than measures
    } else {
        s.offsetMs += T7.OFFSET_LEAK_MS_PER_S * (nowMs - s.offsetAtMs) / 1000;
    }
    s.offsetAtMs = nowMs;
    // Latest device count congruent to pbNow that does not postdate the arrival.
    var limit = (nowMs - s.offsetMs + T7.ARRIVAL_EPS_MS) * perMs;
    var u = pbNow + T7.PB_WRAP * Math.floor((limit - pbNow) / T7.PB_WRAP);
    var reanchor = false;
    if (s.pbU !== null && u <= s.pbU) {
        // Arrived earlier than the envelope allows: the envelope was too high. Take the
        // smallest forward interval; lowerEnvelope then moves the envelope down to it.
        var d = (pbNow - s.pbU) % T7.PB_WRAP;
        if (d < 0) { d += T7.PB_WRAP; }
        u = s.pbU + (d === 0 ? T7.PB_WRAP : d);
        reanchor = true;
    }
    return {u: u, q: nowMs - s.offsetMs - u / perMs, reanchor: reanchor};
};

// An ordinary placement can lower the envelope by at most ARRIVAL_EPS_MS. A reanchor can lower
// it by up to a whole wrap, and at slow speed a reanchor usually means the previous placement
// was a misread, not that the envelope was high; following it fully would inflate every later
// delay estimate and breed more misreads (measured as a ~4 ms drift in 6 s under stalls). So a
// reanchor moves the envelope fully only at established speed >= HOLD_MIN_TPS, else by
// ENV_SLOW_REANCHOR_GAIN.
T7.ENV_SLOW_REANCHOR_GAIN = 0.1;
T7.lowerEnvelope = function(s, q, full) {
    if (q < 0) { s.offsetMs += full ? q : T7.ENV_SLOW_REANCHOR_GAIN * q; }
};

// Deliberately does NOT touch lastPos: platter writes it before calling ensureScratch, so
// clearing it here would swallow the edge that triggered the enable.
T7.resetTiming = function(deck) {
    var s = T7.decks[deck];
    if (!s) { return; }
    s.lastPitchBend = null;
    s.lastEdgeMs = null;
    s.pbU = null;             // device count of the last accepted edge. offsetMs survives: the
    s.spanTicks = 0;          // device-host clock relation does not depend on track state.
    s.acceptedMs = null;
    s.holdStartMs = null;
    s.holdMsgs = 0;
    s.holdLastU = null;
    s.dPrevPB = null;          // original-rule chain: previous PitchBend and its arrival
    s.dPrevMs = null;
    s.dSpanCounts = 0;         // original-rule counts accumulated since the last accept
    s.tickCounts = [Infinity, Infinity];   // last two v1 per-tick intervals
    s.v1Placed = 0;
    s.pendingTicks = 0;
    s.velTicksPerSec = 0;
    s.samplePosition = 0;
    if (s.decayTimer) { engine.stopTimer(s.decayTimer); s.decayTimer = 0; }
};

// ============================================================================
// HANDOVER (v4). The vinyl's measured speed is compared with the speed the motor drives it at
// (the commanded motor ratio, 0 with the motor off). The comparison uses a short exponential
// average of the published measurement so single-edge noise cannot flip the mode.
//   ENGAGE (vinyl drives audio): |deviation| > ENGAGE_TOL for ENGAGE_MS, or > ENGAGE_HARD at once.
//   RELEASE (engine drives audio): |deviation| < RELEASE_TOL continuously for RELEASE_MS.
// While engaged, scratch2 is exactly what the base decoder published. Releasing disables scratch2; the
// engine continues from the current position, so neither mode change jumps.
// Tolerances are first estimates (measured: motor holds speed to ~0.1 %, a finger on the platter
// side moved the vinyl ~6 %); tune by ear.
// ============================================================================
T7.ENGAGE_TOL = 0.03;
T7.ENGAGE_MS = 20;
T7.ENGAGE_HARD = 0.25;
T7.RELEASE_TOL = 0.015;
T7.RELEASE_MS = 150;
T7.DETECT_ALPHA = 0.1;                    // per published observation (~1 per 0.9 ms at 1.0x)
T7.motorRatio = function(deck) {
    var s = T7.decks[deck];
    if (!s || !s.motorOn || s.motorValue === null || s.motorValue === undefined) { return 0; }
    return (s.motorValue + T7.MOTOR_CENTER) / T7.MOTOR_FULL_SCALE;
};
T7.engage = function(deck, why) {
    var s = T7.decks[deck];
    s.engaged = true; s.devSince = null; s.okSince = null;
    T7.trace({ev: "handover", deck: deck, t: Date.now(), act: "engage", why: why});
};
T7.release = function(deck, why) {
    var s = T7.decks[deck], group = T7.group(deck);
    s.engaged = false; s.devSince = null; s.okSince = null;
    if (engine.getValue(group, "scratch2_enable")) {
        engine.setValue(group, "scratch2", 0);
        engine.setValue(group, "scratch2_enable", 0);
    }
    T7.trace({ev: "handover", deck: deck, t: Date.now(), act: "release", why: why});
};
T7.publishRate = function(deck) {
    var s = T7.decks[deck];
    var ratio = s.velTicksPerSec / T7.NOMINAL_TPS;
    if (!isFinite(ratio) || Math.abs(ratio) < T7.RATE_EPSILON) { ratio = 0; }
    var group = T7.group(deck);
    var nowMs = Date.now();
    var motor = T7.motorRatio(deck);
    s.detect = (s.detect === null || s.detect === undefined || ratio === 0) ? ratio
        : s.detect + T7.DETECT_ALPHA * (ratio - s.detect);
    var dev = Math.abs(s.detect - motor);
    if (!s.engaged) {
        // One far-off reading can be a wrap misread during a delivery stall (seen: 0.114x in a
        // steady 1.002x stream), so a hard engage needs two in a row - or a real stop (0).
        var far = Math.abs(ratio - motor) > T7.ENGAGE_HARD;
        if (far && dev > T7.ENGAGE_TOL && (ratio === 0 || s.farLast)) {
            T7.engage(deck, "hard");
        } else if (dev > T7.ENGAGE_TOL) {
            if (s.devSince === null || s.devSince === undefined) { s.devSince = nowMs; }
            if (nowMs - s.devSince >= T7.ENGAGE_MS) { T7.engage(deck, "sustained"); }
        } else {
            s.devSince = null;
        }
    } else if (dev < T7.RELEASE_TOL) {
        if (s.okSince === null || s.okSince === undefined) { s.okSince = nowMs; }
        if (nowMs - s.okSince >= T7.RELEASE_MS) { T7.release(deck, "at motor speed"); }
    } else {
        s.okSince = null;
    }
    s.farLast = Math.abs(ratio - motor) > T7.ENGAGE_HARD;
    if (!s.engaged) { return; }
    if (!engine.getValue(group, "scratch2_enable")) {
        engine.setValue(group, "scratch2_enable", 1);
    }
    engine.setValue(group, "scratch2", ratio);
};

// Only ever reduces speed. A still record decays to silence and stays there.
T7.armDecay = function(deck) {
    var s = T7.decks[deck];
    if (s.decayTimer) { engine.stopTimer(s.decayTimer); }
    s.ticksAtArm = s.netTicks;
    // wrap-v3: allow twice the current per-tick interval before declaring a stop (see make_v3.py).
    // Only consecutive same-direction readings define a speed; one-tick dither (alternating
    // direction, e.g. a held record) keeps the plain DECAY_MS timeout.
    var timeoutMs = T7.DECAY_MS;
    if (s.velTicksPerSec !== 0 && s.sameDirection) {
        var capMs = 2000 / (T7.RATE_EPSILON * T7.NOMINAL_TPS);
        timeoutMs = Math.max(T7.DECAY_MS, Math.min(capMs, Math.ceil(2000 / Math.abs(s.velTicksPerSec))));
    }
    s.decayDeadline = Date.now() + timeoutMs;
    T7.startDecayTimer(deck, timeoutMs);
};
// wrap-v3-deadline: the stop callback acts only once its intended deadline has actually passed.
T7.startDecayTimer = function(deck, ms) {
    var s = T7.decks[deck];
    s.decayTimer = engine.beginTimer(ms, function() {
        var st = T7.decks[deck];
        st.decayTimer = 0;
        var early = st.decayDeadline - Date.now();
        if (early > 0) {
            st.earlyStopFires = (st.earlyStopFires || 0) + 1;
            (st.earlyStopMs = st.earlyStopMs || []).push(early);
            T7.startDecayTimer(deck, early);
            return;
        }
        if (st.netTicks !== st.ticksAtArm) {
            // Movement arrived but may never be published (held interval, lost timestamp):
            // keep watching, otherwise the last command would stand indefinitely.
            T7.trace({ev: "stop", deck: deck, t: Date.now(), act: "recheck"});
            T7.armDecay(deck);
            return;
        }
        st.velTicksPerSec = 0;                            // no new ticks: stop, do not coast
        T7.publishRate(deck);
        if (st.engaged && T7.motorRatio(deck) === 0) { T7.release(deck, "still, motor off"); }
        T7.trace({ev: "stop", deck: deck, t: Date.now(), act: "stop", out: 0});
    }, true);
};

T7.ensureScratch = function(deck) {
    var g = T7.group(deck);
    if (!engine.getValue(g, "track_loaded")) return false;
    if (T7.MODE === "rate") {
        return true;     // v4: measurement always runs; publishRate decides who drives the audio
    }
    // Use the audio-thread position controller rather than the legacy filter's
    // assumed 1ms script timer. Position units are interleaved track samples.
    var group = T7.group(deck);
    if (!engine.getValue(group, "scratch_position_enable")) {
        T7.decks[deck].samplePosition = 0;
        engine.setValue(group, "scratch_position", 0);
        engine.setValue(group, "scratch_position_enable", 1);
    }
    return true;
};
T7.stopScratch = function(deck) {
    var g = T7.group(deck);
    engine.setValue(g, "scratch_position_enable", 0);
    engine.setValue(g, "scratch2", 0);
    engine.setValue(g, "scratch2_enable", 0);
    T7.resetTiming(deck);
    T7.decks[deck].lastPos = null;
};
T7.syncTransport = function(deck) {
    var group = T7.group(deck);
    if (engine.getValue(group, "track_loaded")) {
        // Establish vinyl control before starting the motor, including when the
        // record is already held stationary as PLAY is pressed.
        T7.ensureScratch(deck);
        var playing = engine.getValue(group, "play") > 0;
        var st = T7.decks[deck];
        if (st.motorOn !== playing) {
            // Motor start/stop: the vinyl lags the motor, so it drives the audio until it
            // reaches the new speed. scratch2 starts from the vinyl's current speed.
            var v = st.velTicksPerSec / T7.NOMINAL_TPS;
            if (!isFinite(v) || Math.abs(v) < T7.RATE_EPSILON) { v = 0; }
            engine.setValue(group, "scratch2", v);
            engine.setValue(group, "scratch2_enable", 1);
            T7.engage(deck, playing ? "motor start" : "motor stop");
        }
        T7.setMotorSpeed(deck, engine.getValue(group, "rate_ratio"));
        T7.setMotor(deck, playing);
    } else {
        T7.setMotor(deck, false);
        T7.stopScratch(deck);
    }
};
T7.init = function() {
    // Idempotent initialization: no leaked connections on mapping reload.
    T7.connections.forEach(function(c) { c.disconnect(); });
    T7.connections = [];
    [1, 2].forEach(function(deck) {
        // A repeated init discards the velocity estimate, so it must also discard the command
        // that estimate produced: cancel the old stop timer AND publish zero.
        if (T7.decks[deck] && T7.decks[deck].decayTimer) { engine.stopTimer(T7.decks[deck].decayTimer); }
        if (engine.getValue(T7.group(deck), "scratch2_enable")) { engine.setValue(T7.group(deck), "scratch2", 0); }
        T7.decks[deck] = {lastPos: null, messages: 0, netTicks: 0,
            ambiguous: 0, tempoMSB: null, lastPitchBend: null, motorValue: null,
            pendingTicks: 0, velTicksPerSec: 0, skew: null, devSeconds: 0, decayTimer: 0, samplePosition: 0, lastEdgeMs: null, ticksAtArm: 0,
            pbU: null, spanTicks: 0, acceptedMs: null, holdStartMs: null, holdMsgs: 0, offsetMs: null, offsetAtMs: 0,
            holdLastU: null, dPrevPB: null, dPrevMs: null, dSpanCounts: 0, tickCounts: [Infinity, Infinity], v1Placed: 0,
            motorOn: false, engaged: false, detect: null, devSince: null, okSince: null};
        var group = T7.group(deck);
        T7.connections.push(engine.makeConnection(group, "play", function() {
            T7.syncTransport(deck);
        }));
        T7.connections.push(engine.makeConnection(group, "rate_ratio", function(value) {
            T7.setMotorSpeed(deck, value);
        }));
        T7.connections.push(engine.makeConnection(group, "track_loaded", function() {
            T7.resetTiming(deck);
            T7.decks[deck].lastPos = null;
            T7.syncTransport(deck);
        }));
        T7.syncTransport(deck);
    });
};
T7.shutdown = function() {
    console.log('T7_STOP_DEADLINE ' + JSON.stringify([1, 2].map(function(d) {
        var st = T7.decks[d] || {}; return {deck: d, earlyFires: st.earlyStopFires || 0, earlyMs: st.earlyStopMs || []};
    })));
    T7.connections.forEach(function(c) { c.disconnect(); });
    T7.connections = [];
    [1, 2].forEach(function(deck) {
        T7.setMotor(deck, false);
        T7.setMotorSpeed(deck, 1.0);
        T7.stopScratch(deck);
    });
};
T7.platter = function(channel, control, value, status, group) {
    var deck = T7.deckFromGroup(group);
    if (deck === null || value < 0 || value > 127) return;
    var s = T7.decks[deck];
    s.messages++;
    var previous = s.lastPos;
    s.lastPos = value;
    if (!T7.ensureScratch(deck) || previous === null) return;
    var ticks = T7.tickDelta(previous, value);
    if (ticks === null) { s.ambiguous++; return; }
    s.netTicks += ticks;
    var sampleRate = engine.getValue(group, "track_samplerate");
    s.samplePosition += ticks * 2 * sampleRate * 60 / (T7.INTERVALS_PER_REV * T7.RPM);
    if (T7.MODE === "rate") {
        s.pendingTicks += ticks;
        return;
    }
    // Always publish the plain position first. If the paired PitchBend never arrives -
    // different firmware, the timestamp control unmapped - the platter still works and
    // simply loses the timing correction. The timestamp handler then refines this value.
    engine.setValue(group, "scratch_position", s.samplePosition);
    s.pendingTicks += ticks;
};

// Paired timestamp for the tick just reported on CC#9.
T7.platterTime = function(channel, control, value, status, group) {
    var deck = T7.deckFromGroup(group);
    if (deck === null) { return; }
    var s = T7.decks[deck];
    if (s === undefined) { return; }
    if (T7.MODE === "rate") {
        var pbNow = ((value & 0x7F) << 7) | (control & 0x7F);
        var nowMs = Date.now();
        var moved = s.pendingTicks;
        s.pendingTicks = 0;
        // Original-rule chain: reference moves on every PitchBend, exactly as in the original.
        var dCounts = s.dPrevPB === null ? null : T7.pbForward(s.dPrevPB, pbNow, s.dPrevMs === null ? 0 : nowMs - s.dPrevMs);
        s.dPrevPB = pbNow;
        s.dPrevMs = nowMs;
        if (!T7.ensureScratch(deck)) { return; }
        // An unpaired timestamp carries no movement and its edge's position is unknown, so it
        // is not a reference for the next interval either: the next CC#9 delta is measured from
        // the last paired edge, so its time must be too.
        if (moved === 0 && s.pbU !== null) {
            T7.trace({ev: "pb", deck: deck, t: nowMs, m: 0, pb: pbNow, act: "unpaired"});
            return;
        }
        var place = T7.pbPlace(s, pbNow, nowMs);
        if (s.pbU === null) {
            s.pbU = place.u;
            s.acceptedMs = nowMs;
            s.spanTicks = 0;
            s.holdStartMs = null;
            s.holdMsgs = 0;
            s.holdLastU = null;
            s.dSpanCounts = 0;
            s.tickCounts = [Infinity, Infinity];
            s.v1Placed = 0;
            T7.lowerEnvelope(s, place.q, true);
            T7.trace({ev: "pb", deck: deck, t: nowMs, m: moved, pb: pbNow, u: place.u,
                q: place.q, act: "seed"});
            return;
        }
        s.spanTicks += moved;
        if (dCounts !== null && dCounts > 0) { s.dSpanCounts += dCounts; }
        var span = s.spanTicks;
        var act = place.reanchor ? "reanchor" : "accept";
        var u = place.u;
        var fast = s.v1Placed >= T7.V1_SEASON && s.tickCounts[0] < T7.PB_WRAP / 2 && s.tickCounts[1] < T7.PB_WRAP / 2;
        // A backlog holds back FAST ticks; a held message more than half a wrap after the
        // previous held one contradicts that reading and ends the hold.
        var contradicted = s.holdLastU !== null && u - s.holdLastU >= T7.PB_WRAP / 2;
        if (contradicted) { act = "hold-contradicted"; }
        if (fast && !contradicted && !place.reanchor && Math.abs(s.velTicksPerSec) >= T7.HOLD_MIN_TPS && nowMs - s.acceptedMs <= T7.FRESH_MS
                && span !== 0 && (span > 0) === (s.velTicksPerSec > 0)) {
            // Excess of the host reading over the time the current estimate predicts.
            var predictedMs = span / s.velTicksPerSec * 1000;
            var excessMs = (u - s.pbU) / (T7.PB_HZ / 1000) - predictedMs;
            var j = Math.round(excessMs / T7.WRAP_MS);
            if (j >= 1 && u - j * T7.PB_WRAP > s.pbU && place.q + j * T7.WRAP_MS <= T7.QUEUE_MAX_MS
                    && Math.abs(excessMs - j * T7.WRAP_MS) <= T7.HOLD_TOL_MS + T7.HOLD_TOL_FRAC * predictedMs) {
                if (s.holdStartMs === null) { s.holdStartMs = nowMs; s.holdMsgs = 0; }
                s.holdMsgs++;
                if (s.holdMsgs >= T7.HOLD_MIN_MSGS) {
                    u -= j * T7.PB_WRAP;
                    place.q += j * T7.WRAP_MS;
                    act = "hold-resolved-delay";
                } else if (nowMs - s.holdStartMs < T7.HOLD_MAX_MS) {
                    s.holdLastU = u;
                    T7.trace({ev: "pb", deck: deck, t: nowMs, m: moved, span: span, pb: pbNow,
                        u: u, q: place.q, excessMs: excessMs, fewerWraps: j, act: "hold",
                        vel: s.velTicksPerSec});
                    T7.armDecay(deck);
                    return;
                } else {
                    act = "hold-expired";
                }
            }
        }
        if (span === 0) {
            // Net-zero movement since the last accepted edge (e.g. +1 then -1 across a hold):
            // re-reference time, publish nothing; the stop timer governs stillness.
            T7.lowerEnvelope(s, place.q, !place.reanchor || Math.abs(s.velTicksPerSec) >= T7.HOLD_MIN_TPS);
            s.pbU = u;
            s.acceptedMs = nowMs;
            s.holdStartMs = null;
            s.holdLastU = null;
            s.dSpanCounts = 0;
            T7.trace({ev: "pb", deck: deck, t: nowMs, m: moved, span: 0, pb: pbNow, u: u,
                q: place.q, act: "net-zero"});
            return;
        }
        var v1Counts = u - s.pbU;
        // Published reading: v1 in the fast regime, otherwise the original rule (if it has one).
        var useOriginal = !fast && s.dSpanCounts > 0;
        var counts = useOriginal ? s.dSpanCounts : v1Counts;
        var observed = span / (counts / T7.PB_HZ);
        s.sameDirection = s.lastSpanSign === (span > 0 ? 1 : -1);   // wrap-v3
        s.lastSpanSign = span > 0 ? 1 : -1;
        s.pbU = u;
        s.acceptedMs = nowMs;
        s.spanTicks = 0;
        s.holdStartMs = null;
        s.holdLastU = null;
        s.dSpanCounts = 0;
        s.tickCounts = [s.tickCounts[1], v1Counts / Math.abs(span)];
        s.v1Placed++;
        T7.lowerEnvelope(s, place.q, !place.reanchor || Math.abs(s.velTicksPerSec) >= T7.HOLD_MIN_TPS);
        s.velTicksPerSec = s.velTicksPerSec === 0
            ? observed
            : s.velTicksPerSec + T7.VEL_SMOOTH * (observed - s.velTicksPerSec);
        T7.publishRate(deck);
        T7.armDecay(deck);
        if (T7.TRACE_SINK) {
            T7.trace({ev: "pb", deck: deck, t: nowMs, m: moved, span: span, pb: pbNow, u: u,
                counts: counts, v1Counts: v1Counts, published: useOriginal ? "original" : "v1",
                wraps: Math.floor(counts / T7.PB_WRAP), q: place.q, act: act,
                obs: observed, vel: s.velTicksPerSec, out: engine.getValue(group, "scratch2")});
        }
        return;
    }
    if (!T7.PREDICT) { return; }
    // mido-style 14-bit assembly: control is the LSB, value the MSB.
    var pb = ((value & 0x7F) << 7) | (control & 0x7F);
    var last = s.lastPitchBend;
    s.lastPitchBend = pb;
    var ticks = s.pendingTicks;
    s.pendingTicks = 0;
    if (last === null || !T7.ensureScratch(deck)) { return; }

    var dt = T7.pbDelta(last, pb) / T7.PB_HZ;
    if (dt <= 0 || dt > 0.05) { return; }      // wrapped or stale: skip this observation
    s.devSeconds += dt;
    if (ticks !== 0) {
        var observed = ticks / dt;
        s.velTicksPerSec = s.velTicksPerSec === 0
            ? observed
            : s.velTicksPerSec + T7.VEL_SMOOTH * (observed - s.velTicksPerSec);
    }

    // Track the offset between the device clock and wall time, then predict forward by
    // however long ago this edge actually happened.
    var wall = Date.now() / 1000;
    var offset = wall - s.devSeconds;
    s.skew = s.skew === null ? offset : s.skew + 0.02 * (offset - s.skew);
    var lead = wall - (s.devSeconds + s.skew);
    if (!(lead > 0)) { lead = 0; }
    if (lead > T7.MAX_LEAD_S) { lead = T7.MAX_LEAD_S; }

    var sampleRate = engine.getValue(group, "track_samplerate");
    var samplesPerTick = 2 * sampleRate * 60 / (T7.INTERVALS_PER_REV * T7.RPM);
    engine.setValue(group, "scratch_position",
        s.samplePosition + s.velTicksPerSec * samplesPerTick * lead);
};
T7.play = function(channel, control, value, status, group) {
    var deck = T7.deckFromGroup(group);
    if (deck === null || (status & 0xF0) !== 0x90 || value === 0) return;
    engine.setValue(group, "play", engine.getValue(group, "play") ? 0 : 1);
};
