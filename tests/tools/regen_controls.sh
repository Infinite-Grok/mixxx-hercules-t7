#!/usr/bin/env bash
# Regenerate tests/controls-2.5.txt from the Mixxx 2.5.6 TAG (the release the mapping targets), not the checkout working tree.
# The checkout $MIXXX_SRC is only read (git archive); sources go to a temp dir that is removed afterwards.
#
# Usage (from the repo root, on Linux, macOS or WSL):
#   MIXXX_SRC=/path/to/mixxx-2.5 bash tests/tools/regen_controls.sh > tests/controls-2.5.txt
set -euo pipefail
REPO="${MIXXX_SRC:?set MIXXX_SRC to a git checkout of Mixxx, e.g. MIXXX_SRC=/path/to/mixxx-2.5}"
TAG="${1:-2.5.6}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$(mktemp -d /tmp/t7-audit-XXXXXX)"
trap 'rm -rf "$D"' EXIT
COMMIT="$(git -C "$REPO" rev-parse "$TAG^{commit}")"
git -C "$REPO" archive "$TAG" src | tar -x -C "$D"
T7_SRC_DESC="mixxx $TAG (tag, commit $COMMIT) via git archive" python3 "$HERE/extract_controls_2.5.py" "$D"
