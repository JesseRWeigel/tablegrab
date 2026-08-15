#!/usr/bin/env python3
"""Break the engine on purpose and require the tests to notice.

A green suite proves nothing by itself. It has to be shown failing on a tree that is genuinely
wrong, otherwise "all green" only means "nothing ran".

Three gates, and a sabotage counts only if it clears all three.

  1. It APPLIES. The edit changed the file. A patch whose target text has drifted does nothing,
     and a suite passing against an unmodified tree looks exactly like a suite that caught it.
  2. It MOVES THE MEASUREMENT. `scripts/measure.py` prints a different fingerprint. A change
     that alters no output is a refactor, and requiring the tests to catch it would be asking
     them to have an opinion about style.
  3. Only then, it is CAUGHT. The unit suite fails.

Guard code inverts gate 2. A check that nothing currently trips cannot change the output when it
is disabled, so for those the requirement is the opposite and stricter: the fingerprint stays
identical and the suite fails anyway. A guard whose removal moves the output was never dormant.

The null control runs first: an unmodified copy of the tree, in a directory with a different
name and a different path length, must fingerprint identically. If it does not, the measurement
tracks where the code lives rather than what it does, gate 2 is free for every sabotage below,
and the run is void.
"""

from __future__ import annotations

import glob
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKIP = {".git", ".venv", "__pycache__", "node_modules", "docs"}

# (name, file, find, replace, dormant)
SABOTAGES = [
    # ---------------------------------------------------------------- the reader
    ("colspan and rowspan attributes are ignored", "src/parse.js",
     "  const raw = attrs[name];\n  if (raw === undefined) return 1;",
     "  const raw = attrs[name];\n  return 1;", False),
    ("entities are left encoded", "src/parse.js",
     "  return decodeEntities(text)", "  return String(text)", False),
    ("whitespace inside a cell is not collapsed", "src/parse.js",
     "    .replace(/\\s+/g, ' ')", "    .replace(/[ \\t]+/g, ' ')", False),
    ("script and style contents reach the cells", "src/parse.js",
     "    if (!closing && (name === 'script' || name === 'style')) {",
     "    if (false) {", False),
    ("every inline tag inserts a space", "src/parse.js",
     "    if (BLOCK_TAGS.has(name)) addText(' ');\n  }",
     "    addText(' ');\n  }", False),
    # ---------------------------------------------------------------- the grid
    ("a rowspan covers only its own row", "src/grid.js",
     "      for (let dr = 0; dr < rowspan; dr += 1) {",
     "      for (let dr = 0; dr < 1; dr += 1) {", False),
    ("occupied slots are not skipped, so spans overwrite their neighbours", "src/grid.js",
     "      while (slots[r][c] !== undefined) c += 1;", "      ;", False),
    ('rowspan="0" is treated as a single row', "src/grid.js",
     "        rowspan = sectionEnd(rows, r) - r + 1;", "        rowspan = 1;", False),
    ("sections keep their source order instead of thead, tbody, tfoot", "src/grid.js",
     "    if (left !== right) return left - right;", "    if (false) return left - right;", False),
    ("a header repeated down a rowspan is repeated in the column name", "src/grid.js",
     "      if (parts.length && parts[parts.length - 1] === text) continue;",
     "      if (false) continue;", False),
    ("short rows are padded silently", "src/grid.js",
     "    if (filled < width) ragged.push({ row: r, filled, width });", "    ;", False),
    ("every leading row counts as a header row", "src/grid.js",
     "    if (!anchors.every((slot) => slot.header)) break;", "    if (false) break;", False),
    ("duplicate column names are left duplicated", "src/grid.js",
     "    return count === 0 ? name : `${name}_${count + 1}`;", "    return name;", False),
    ("an overlapping span overwrites the cell already there", "src/grid.js",
     "            notes.push(`row ${r + dr} col ${c + dc}: overlapping spans, later cell "
     "dropped`);\n            continue;",
     "            notes.push(`row ${r + dr} col ${c + dc}: overlapping spans, later cell "
     "dropped`);", False),
    ("a rowspan running past the last row is not clipped", "src/grid.js",
     "      rowspan = Math.max(1, Math.min(rowspan, rows.length - r));",
     "      rowspan = Math.max(1, rowspan);", True),
    # ---------------------------------------------------------------- inference
    ("the leading zero guard is removed, so postcodes become numbers", "src/infer.js",
     "  if (/^0\\d/.test(s)) return null;", "  if (false) return null;", False),
    ("a version string is read as a number", "src/infer.js",
     "    [/^(\\d{1,3}(?:\\.\\d{3}){2,})$/, (m) => Number(m[1].replace(/\\./g, ''))],",
     "    [/^(\\d{1,3}(?:\\.\\d+){2,})$/, (m) => Number(m[1].replace(/\\./g, ''))],", False),
    ("impossible dates are accepted", "src/infer.js",
     "  if (!(y >= 1 && y <= 9999) || !(m >= 1 && m <= 12) || d < 1) return false;",
     "  return true;", False),
    ("an ambiguous date is never settled by the rest of its column", "src/infer.js",
     "      if (evidence.has('dmy') && !evidence.has('mdy')) dayFirst = true;",
     "      if (false) dayFirst = true;", False),
    ("a mixed column keeps its cells typed one by one", "src/infer.js",
     "    if (cell.type !== 'empty' && cell.type !== 'string') {",
     "    if (false) {", False),
    ("a dash or n/a becomes text rather than an empty value", "src/infer.js",
     "  if (text === '' || NULLISH.has(text.toLowerCase())) {", "  if (text === '') {", False),
    ("a percentage stays text", "src/infer.js",
     "  if (s.endsWith('%')) {", "  if (false) {", False),
    ("the currency is dropped from the column label", "src/infer.js",
     "    if (inferred.type === 'number' && inferred.currency) label += ` (${inferred.currency})`;",
     "    if (false) label += '';", False),
    # ---------------------------------------------------------------- layout detection
    ("a nested table is no longer a layout signal", "src/detect.js",
     "  if (grid.hasNestedTable) {", "  if (false) {", False),
    ("everything counts as a data table", "src/detect.js",
     "  return { isData: score < 3, score, reasons };",
     "  return { isData: score < 99, score, reasons };", False),
    ("role=presentation is ignored", "src/detect.js",
     "  if (PRESENTATION_ROLES.has(role)) {", "  if (false) {", False),
    # ---------------------------------------------------------------- the outputs
    ("csv fields are never quoted", "src/emit.js",
     "  const needsQuote = text.includes(delimiter) || text.includes('\"') "
     "|| /[\\r\\n]/.test(text)\n    || text !== text.trim();",
     "  const needsQuote = false;", False),
    ("a quote inside a csv field is not doubled", "src/emit.js",
     "  return needsQuote ? `\"${text.replace(/\"/g, '\"\"')}\"` : text;",
     "  return needsQuote ? `\"${text}\"` : text;", False),
    ("an apostrophe is not escaped in the sql output", "src/emit.js",
     "  return `'${text.replace(/'/g, \"''\")}'`;", "  return `'${text}'`;", False),
    ("sql identifiers are used exactly as the header wrote them", "src/emit.js",
     "  let out = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+/g, '_')\n"
     "    .replace(/^_+|_+$/g, '');",
     "  let out = String(name);", False),
    ("the outputs carry the original text instead of the parsed value", "src/emit.js",
     "  if (cell.type === 'number') return String(cell.value);", "  return cell.raw;", False),
    ("a pipe in a markdown cell is not escaped", "src/emit.js",
     "  return text.replace(/\\|/g, '\\\\|').replace(/\\r?\\n/g, ' ');",
     "  return text.replace(/\\r?\\n/g, ' ');", False),
    ("an empty table still gets an INSERT statement", "src/emit.js",
     "  if (!analysis.rows.length) return create + '\\n';", "  if (false) return create;", True),
    ("an unknown output format is silently empty", "src/emit.js",
     "  if (!fn) throw new Error(`unknown format: ${format}`);", "  if (false) throw new Error();",
     True),
]


def copy_tree(destination: str) -> None:
    os.makedirs(destination, exist_ok=True)
    for name in os.listdir(ROOT):
        if name in SKIP:
            continue
        source = os.path.join(ROOT, name)
        target = os.path.join(destination, name)
        if os.path.isdir(source):
            shutil.copytree(source, target, ignore=shutil.ignore_patterns(*SKIP))
        else:
            shutil.copy2(source, target)


def run(tree: str, args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, cwd=tree, capture_output=True, text=True,
        env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    )


def fingerprint(tree: str) -> str | None:
    out = run(tree, [sys.executable, os.path.join("scripts", "measure.py")])
    for line in out.stdout.splitlines():
        if line.startswith("FINGERPRINT "):
            return line.split(" ", 1)[1].strip()
    return None


def tests_pass(tree: str) -> bool:
    # Expanded here rather than by node, which only learned to do it recently.
    files = sorted(glob.glob(os.path.join(tree, "tests", "*.test.js")))
    names = [os.path.join("tests", os.path.basename(name)) for name in files]
    if not names:
        raise RuntimeError("no test files in the copied tree")
    return run(tree, ["node", "--test", *names]).returncode == 0


def main() -> int:
    workspace = tempfile.mkdtemp(prefix="tablegrab-sabotage-")

    baseline_tree = os.path.join(workspace, "baseline")
    copy_tree(baseline_tree)
    baseline = fingerprint(baseline_tree)
    if baseline is None:
        print("FAIL the baseline tree produced no fingerprint at all")
        return 1

    control_tree = os.path.join(workspace, "a-differently-named-directory")
    copy_tree(control_tree)
    control = fingerprint(control_tree)
    if control != baseline:
        print("FAIL null control: an unmodified copy fingerprinted differently.")
        print(f"     baseline {baseline}\n     control  {control}")
        print("     The measurement tracks the working directory rather than the code, so gate 2")
        print("     would pass for free for every sabotage below. Not scoring this run.")
        return 1
    print(f"null control: an unmodified copy fingerprints identically ({baseline[:16]})")

    if not tests_pass(baseline_tree):
        print("FAIL the suite does not pass on an unsabotaged tree, so a failure below would "
              "mean nothing")
        return 1
    print("baseline: the suite passes before anything is broken\n")

    caught = 0
    failures: list[str] = []
    for index, (name, relative, find, replace, dormant) in enumerate(SABOTAGES):
        tree = os.path.join(workspace, f"s{index:02d}")
        copy_tree(tree)
        path = os.path.join(tree, relative)
        with open(path, encoding="utf-8") as handle:
            original = handle.read()
        if find not in original:
            failures.append(f"{name}: DID NOT APPLY, the target text is not in {relative}")
            print(f"  gate 1 FAIL  {name}")
            continue
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(original.replace(find, replace, 1))

        moved = fingerprint(tree)
        if dormant:
            if moved != baseline:
                failures.append(
                    f"{name}: expected dormant guard code, but the output moved, so it was doing "
                    f"something visible and this is not a guard. Rerun it as a plain attack.")
                print(f"  gate 2 FAIL  {name} (a dormant guard changed the output)")
                continue
        else:
            if moved is None:
                failures.append(f"{name}: the tree stopped producing a fingerprint at all")
                print(f"  gate 2 FAIL  {name} (no output to compare)")
                continue
            if moved == baseline:
                failures.append(
                    f"{name}: APPLIED but changed nothing measurable, so either the fixtures never "
                    f"exercise it or the edit was a no-op")
                print(f"  gate 2 FAIL  {name} (output unchanged)")
                continue

        if tests_pass(tree):
            failures.append(f"{name}: NOT CAUGHT, the suite passed on a broken tree")
            print(f"  gate 3 FAIL  {name}")
            continue

        caught += 1
        print(f"  caught       {name} ({'dormant guard' if dormant else 'output moved'})")

    print()
    dormant_count = sum(1 for entry in SABOTAGES if entry[4])
    print(f"{caught} of {len(SABOTAGES)} sabotages caught "
          f"({dormant_count} of them scored as dormant guard code)")
    for message in failures:
        print(f"  FAIL {message}")
    if failures:
        print("SABOTAGE SUITE FAILED")
        return 1
    print("SABOTAGE SUITE PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
