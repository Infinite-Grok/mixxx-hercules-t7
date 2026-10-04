#!/usr/bin/env python3
# ruff: noqa
"""Extract the set of Mixxx 2.5 control names ([group],key) from the C++ sources.

Run it through tools/regen_controls.sh, which feeds it the sources of the 2.5.6 TAG (the Mixxx release the mapping targets;
the checkout working tree may be newer) via git archive and never modifies the checkout:

  MIXXX_SRC=/path/to/mixxx-2.5 bash tests/tools/regen_controls.sh > tests/controls-2.5.txt

Method (see tests/AUDIT.md for the known gaps):
  1. Every `ConfigKey(<group>, <key>)` call in src/ (tests excluded) is parsed with balanced parentheses.
  2. <group> and <key> are resolved when they are string literals, QString/QStringLiteral wrappers,
     `QString("..%1..").arg(..)` templates, or named string constants (`kAppGroup`, `kXfaderConfigKey`...).
  3. A group that is a variable (`group`, `m_group`) is dynamic: the entry is tagged with a group
     FAMILY derived from the source path (deck-like, effect, mic, aux, master, ...); unknown paths get `@unknown` (ignored by the audit, listed for manual lookup).
  4. A key that is computed (`keyForControl(...)`) is dynamic: it is listed under SUPPLEMENT, which is hand
     maintained below with the source line it was read from.
Output lines: group<TAB>key<TAB>origin    ('%1' style placeholders are templates)
"""
import os
import re
import subprocess
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/mixxx-2.5")
SRC = os.path.join(ROOT, "src")

# ---- group families, by source path prefix -------------------------------------------------
DECK_LIKE = "@deck"  # [ChannelN] [SamplerN] [PreviewDeckN]
FAMILIES = [
    ("src/engine/channels/engineaux", "[Auxiliary%1]"),
    ("src/engine/channels/enginemicrophone", "[Microphone%1]"),
    ("src/mixer/microphone", "[Microphone%1]"),
    ("src/mixer/auxiliary", "[Auxiliary%1]"),
    ("src/engine/enginemaster", "[Master]"),
    ("src/engine/engineconfig", "[Master]"),
    ("src/engine/enginexfader", "[Master]"),
    ("src/engine/enginedelay", "[Master]"),
    ("src/engine/channels", DECK_LIKE),
    ("src/engine/controls", DECK_LIKE),
    ("src/engine/enginebuffer", DECK_LIKE),
    ("src/engine/bufferscalers", DECK_LIKE),
    ("src/engine/sync", DECK_LIKE),
    ("src/engine/enginepregain", DECK_LIKE),
    ("src/engine/enginevumeter", "@vu"),
    ("src/engine/enginefilter", DECK_LIKE),
    ("src/mixer", DECK_LIKE),
    ("src/vinylcontrol", DECK_LIKE),
    ("src/effects", "@effect"),
]

# ---- hand-maintained supplements (dynamic keys / groups that the parser cannot resolve) -----
# (group, key, origin). Each was read from the cited 2.5 source and is re-checked by `--verify`.
SUPPLEMENT = [
    ("[Channel%1]", "hotcue_%1_activate", "src/engine/controls/hotcuecontrol.cpp keyForControl hotcue_%1_%2"),
    ("[Channel%1]", "hotcue_%1_clear", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_set", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_goto", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_gotoandplay", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_gotoandstop", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_cueloop", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_position", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_enabled", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_color", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_status", "src/engine/controls/hotcuecontrol.cpp"),
    ("[Channel%1]", "hotcue_%1_type", "src/engine/controls/hotcuecontrol.cpp"),
]


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def source_files():
    for d, _, fs in os.walk(SRC):
        rel = os.path.relpath(d, ROOT).replace("\\", "/")
        if "/test" in "/" + rel:
            continue
        for f in fs:
            if f.endswith((".cpp", ".h")):
                yield os.path.join(d, f)


def family_for(rel):
    for pref, fam in FAMILIES:
        if rel.startswith(pref):
            return fam
    return "*"


STR = r'"((?:[^"\\]|\\.)*)"'


def load_constants():
    consts = {}
    pat = re.compile(
        r"(?:const|constexpr|static)[^;=()]*?\b([A-Za-z_]\w*)\s*(?:\[\])?\s*=\s*(?:QStringLiteral\(|QLatin1String\(|QString\()?\s*" + STR
    )
    for p in source_files():
        for m in pat.finditer(read(p)):
            consts.setdefault(m.group(1), set()).add(m.group(2))
    # `static const QString kX = ...` without explicit type match above; also QStringLiteral initialisers
    return consts


def split_args(s):
    """Split on top-level commas; s is the text after the opening paren, returns (args, end_index)."""
    args, depth, cur, i, instr = [], 0, [], 0, False
    while i < len(s):
        c = s[i]
        if instr:
            cur.append(c)
            if c == "\\":
                cur.append(s[i + 1]); i += 1
            elif c == '"':
                instr = False
        elif c == '"':
            instr = True; cur.append(c)
        elif c in "([{":
            depth += 1; cur.append(c)
        elif c in ")]}":
            if depth == 0:
                args.append("".join(cur).strip())
                return args, i
            depth -= 1; cur.append(c)
        elif c == "," and depth == 0:
            args.append("".join(cur).strip()); cur = []
        else:
            cur.append(c)
        i += 1
    return args, i


def resolve(expr, consts):
    """Return a list of candidate string templates, or None if it is dynamic."""
    e = expr.strip()
    # QString("x") / QStringLiteral("x") / QLatin1String("x") -> "x" (keeps a trailing .arg(...) intact)
    e = re.sub(r"\b(?:QStringLiteral|QLatin1String|QString)\s*\(\s*(" + STR + r")\s*\)", r"\1", e)
    e = re.sub(r"\bQStringLiteral\s*\(", "(", e)
    e = re.sub(r"\bQLatin1String\s*\(", "(", e)
    e = re.sub(r"\bQString\s*\(", "(", e)
    e = re.sub(r"\bu8\b", "", e)
    e = re.sub(r"\s+", " ", e)
    # strip one layer of parens
    while e.startswith("(") and e.endswith(")") and split_args(e[1:])[1] == len(e) - 2:
        e = e[1:-1].strip()
    # "lit"  or  "lit%1" .arg(...)
    m = re.fullmatch(STR + r"(?:\s*\.arg\(.*\))*", e)
    if m:
        return [m.group(1)]
    m = re.fullmatch(r"(?:\w+::)*(k\w+|[A-Za-z_]\w*)", e)
    if m and m.group(1) in consts:
        return sorted(consts[m.group(1)])
    # "a" "b" (adjacent literals) or "a" + "b"
    parts = re.findall(STR, e)
    if parts and re.fullmatch(r'(?:\s*(?:\+\s*)?' + STR + r')+(?:\s*\.arg\(.*\))*', e):
        return ["".join(parts)]
    return None


def norm_group(g):
    """[Channel3] -> [Channel%1], [EffectRack1_EffectUnit2_Effect1] -> [EffectRack1_EffectUnit%1_Effect%2], ..."""
    g = re.sub(r"\[(Channel|Sampler|PreviewDeck|Microphone|Auxiliary|Spinny)\d+\]", r"[\1%1]", g)
    g = re.sub(r"EffectUnit\d+_Effect\d+", "EffectUnit%1_Effect%2", g)
    g = re.sub(r"EffectUnit\d+\]", "EffectUnit%1]", g)
    g = re.sub(r"(EqualizerRack1_\[[A-Za-z]+(?:%1)?\]_Effect)\d+", r"\g<1>1", g)
    return g


def norm_key(k):
    """hotcue_6_activate -> hotcue_%1_activate, beatloop_0.5_toggle -> beatloop_%1_toggle, parameter3_x -> parameter%1_x,
    group_[Channel2]_enable -> group_[Channel%1]_enable. Digits glued to a word (scratch2, super1) stay concrete."""
    k = re.sub(r"\[(Channel|Sampler|PreviewDeck|Microphone|Auxiliary)\d+\]", r"[\1%1]", k)
    k = re.sub(r"(?<=_)\d+(?:\.\d+)?(?=_|$)", "%1", k)
    k = re.sub(r"^(button_parameter|parameter)\d+", r"\1%1", k)
    return k


def main():
    consts = load_constants()
    out = {}  # (group, key) -> origin
    dyn_keys, dyn_groups_unknown = [], []
    for p in sorted(source_files()):
        rel = os.path.relpath(p, ROOT).replace("\\", "/")
        txt = read(p)
        for m in re.finditer(r"\bConfigKey\s*\(", txt):
            args, _ = split_args(txt[m.end():])
            if len(args) != 2:
                continue
            line = txt.count("\n", 0, m.start()) + 1
            g = resolve(args[0], consts)
            k = resolve(args[1], consts)
            origin = "%s:%d" % (rel, line)
            if k is None:
                dyn_keys.append((origin, args[1][:60]))
                continue
            if g is None:
                fam = family_for(rel)
                if fam == "*":
                    dyn_groups_unknown.append(origin)
                    fam = "@unknown"
                gs = [fam]
            else:
                gs = g
            for gg in gs:
                for kk in k:
                    if not gg.startswith("[") and not gg.startswith("@") and gg != "*":
                        continue  # a constant resolved to a non-group string
                    out.setdefault((gg, kk), origin)
    for g, k, o in SUPPLEMENT:
        out.setdefault((g, k), "SUPPLEMENT " + o)
    # Source B: the 2.5 test suite's dump of every control that exists at runtime (4 decks, 64 samplers, effects...).
    n_dump = 0
    dump = os.path.join(SRC, "test", "co_dumps", "co_dump_inital.csv")
    if os.path.exists(dump):
        for line in read(dump).splitlines():
            parts = line.rsplit(",", 1)[0].split(",", 1) if line.count(",") >= 2 else None
            if not parts or not parts[0].startswith("["):
                continue
            g, k = norm_group(parts[0]), norm_key(parts[1])
            if (g, k) not in out:
                out[(g, k)] = "co_dump_inital.csv"
                n_dump += 1
    print("# controls-2.5.txt - generated by tests/tools/extract_controls_2.5.py from Mixxx 2.5 (see tests/AUDIT.md)")
    desc = os.environ.get("T7_SRC_DESC") or subprocess.run(["git", "-C", ROOT, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    print("# source: %s" % desc)
    print("# format: group<TAB>key<TAB>origin ; %N = template number ; @deck/@effect/@vu = group family ; @unknown = ignored by the audit")
    print("# dynamic keys not resolved by the parser (%d): see tests/AUDIT.md gap list" % len(dyn_keys))
    for origin, e in dyn_keys:
        print("# DYNKEY %s %s" % (origin, e.replace("\t", " ")))
    print('# dynamic group with unknown family (%d ConfigKey calls, kept as @unknown and IGNORED by the audit); co_dump rows added: %d' % (len(dyn_groups_unknown), n_dump))
    for (g, k), o in sorted(out.items()):
        print("%s\t%s\t%s" % (g, k, o))


if __name__ == "__main__":
    main()
