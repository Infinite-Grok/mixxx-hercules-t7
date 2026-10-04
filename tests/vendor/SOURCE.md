# vendor/ : files copied unmodified from Mixxx 2.5

Source: `res/controllers/` of the Mixxx repository, https://github.com/mixxxdj/mixxx (2.5 branch). All three files are byte-identical in the `2.5.6` tag (SHA-256 of `git show 2.5.6:res/controllers/<file>` compared).

| File | SHA-256 |
|---|---|
| `midi-components-0.0.js` | `207a5e415e2c37c1797552f46cf9873dfed4ad35a4cf515301bb3d5e3dc9a141` |
| `common-controller-scripts.js` | `12c17168b6f9d6b0774ef9c04dd78c1593081eeee04a506b6a6c96efaa1abb86` |
| `lodash.mixxx.js` | `b85109dce09ed22adb83fcff99b25aa6cdbb258471679e86c42f4dcd54225ed1` |

Mixxx always loads `common-controller-scripts.js` before a mapping's own `<scriptfiles>` (`REQUIRED_SCRIPT_FILE`,
`src/controllers/legacycontrollermappingfilehandler.cpp:233`), so the harness does the same. `midi-components-0.0.js` and
`lodash.mixxx.js` are loaded only if the candidate's XML lists them. These copies are test support only and keep
their original licences:

- `midi-components-0.0.js`: GPL-2.0-or-later (Mixxx), as its file header says (copyright 2017 Be).
- `common-controller-scripts.js`: GPL-2.0-or-later (Mixxx). The file has no licence header of its own; it is covered by the
  Mixxx `LICENSE` (GPL version 2 or any later version), https://github.com/mixxxdj/mixxx/blob/2.5.6/LICENSE.
- `lodash.mixxx.js`: MIT, copyright JS Foundation and other contributors (a custom Lodash 4.17.5 build, as its header
  says). The licence text is in `LICENSE-lodash.txt`.
