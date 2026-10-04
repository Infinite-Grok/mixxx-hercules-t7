# Changelog

## 0.9.0-beta (2026-10-03)

First public beta of the Hercules DJControl Inpulse T7 mapping for Mixxx 2.5.6 or later.

- Two decks: PLAY/PAUSE, CUE, SYNC, SHIFT layer, loop controls (IN, OUT, AUTOLOOP knob), tempo range and key lock, nudge with the PARAM buttons, channel fader, gain, EQ, filter and deck headphone button.
- Motorized platters: scratching and nudging, and the platter follows the track's speed. The motor is always on, as in Serato and DJUCED.
- Eight performance pad pages per deck (HOT CUE, LOOP, SAMPLER, BEAT JUMP, ROLL, FX, KEY), with pad colours. Page 3 (stems) is unused in Mixxx 2.5.
- Sampler pads add samplers on demand when a pad above the current sampler count is pressed.
- Browse knob and library buttons (load, enter, back, add to Auto DJ).
- Mixer section: crossfader with the mix / scratch / disabled curve switch, cue/mix knob, master headphone split-cue button.
- Effects: FX slot buttons for both units, effect depth, FX levers (effect on while held), FX -/+ buttons.
- Browse-knob ring flashes on every beat while a deck plays: beat 1 red, beats 2 to 4 blue. Beat 1 is counted from the main cue point.
- Clean start-up and shut-down: lamps are turned off and all timers and connections are removed on exit.
- Offline test suite (Node 22): control-name audit against Mixxx 2.5.6, lifecycle, safety, pad colours, and a byte-identical check of the platter decoder.
