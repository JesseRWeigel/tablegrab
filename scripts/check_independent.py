#!/usr/bin/env python3
"""A second opinion, written in a different language from the thing it is checking.

The engine is JavaScript. This is python, uses html.parser from the standard library, and
implements the span expansion again from the HTML spec rather than calling the engine's version
of it. Where the two disagree, one of them is wrong and the hand-written answers in
fixtures/expected decide which.

It also recomputes a headline number by a route the engine never takes: the totals row of the
merged fixture is re-added from the data rows above it.

Independence is proved rather than asserted. This file's own import graph is walked with `ast`
and must not reach the package or its bridge, and the prover is shown rejecting two probe files
and accepting a third, because a prover that can reject nothing proves nothing.
"""

from __future__ import annotations

import ast
import csv
import io
import json
import os
import subprocess
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROBES = os.path.join(ROOT, "scripts", "probes")
FORBIDDEN_PREFIX = "tablegrab"
SECTION_ORDER = {"thead": 0, "tbody": 1, "tfoot": 2}


# ------------------------------------------------------------------ independence of this file

def imported_names(path: str) -> set[str]:
    with open(path, encoding="utf-8") as handle:
        tree = ast.parse(handle.read(), filename=path)
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                names.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                names.add(node.module.split(".")[0])
            if node.level:
                names.add("<relative>")
        elif isinstance(node, ast.Call):
            target = getattr(node.func, "id", None) or getattr(node.func, "attr", None)
            if target in ("import_module", "__import__"):
                arg = node.args[0] if node.args else None
                names.add(arg.value.split(".")[0]
                          if isinstance(arg, ast.Constant) and isinstance(arg.value, str)
                          else "<computed>")
    return names


def reaches_package(names: set[str]) -> bool:
    return any(name.startswith(FORBIDDEN_PREFIX) or name in ("<computed>", "<relative>")
               for name in names)


def prove_independence() -> list[str]:
    problems = []
    if reaches_package(imported_names(os.path.abspath(__file__))):
        problems.append("this checker imports the package or its bridge")
    else:
        print(f"  independent: imports nothing beginning with {FORBIDDEN_PREFIX!r}")
    probes = sorted(name for name in os.listdir(PROBES) if name.startswith("probe_"))
    if len(probes) < 3:
        return ["fewer than three probes on disk, so the prover was never shown able to reject"]
    for name in probes:
        rejected = reaches_package(imported_names(os.path.join(PROBES, name)))
        should_reject = "clean" not in name
        if rejected != should_reject:
            problems.append(f"{name}: the prover said {'reject' if rejected else 'accept'}")
        else:
            print(f"  {'rejected' if rejected else 'accepted'} as required: {name}")
    return problems


# ------------------------------------------------------------------ a second table reader

class Tables(HTMLParser):
    """Cells, rows and sections. Written against the HTML spec, not against src/parse.js."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tables: list[dict] = []
        self.stack: list[dict] = []
        self.skip = None

    def _top(self):
        return self.stack[-1] if self.stack else None

    def _close_cell(self) -> None:
        table = self._top()
        if table and table.get("cell") is not None:
            table["cell"]["text"] = " ".join("".join(table["cell"]["parts"]).split())
            table["cell"] = None

    def handle_starttag(self, tag, attrs) -> None:
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag in ("script", "style"):
            self.skip = tag
            return
        if tag == "table":
            self.stack.append({"rows": [], "cell": None, "row": None, "section": None,
                               "caption": [], "in_caption": False, "attrs": attributes})
            self.tables.append(self.stack[-1])
            return
        table = self._top()
        if table is None:
            return
        if tag == "caption":
            table["in_caption"] = True
        elif tag in ("thead", "tbody", "tfoot"):
            self._close_cell()
            table["row"] = None
            table["section"] = tag
        elif tag == "tr":
            self._close_cell()
            table["row"] = {"cells": [], "section": table["section"] or "tbody"}
            table["rows"].append(table["row"])
        elif tag in ("td", "th"):
            self._close_cell()
            if table["row"] is None:
                table["row"] = {"cells": [], "section": table["section"] or "tbody"}
                table["rows"].append(table["row"])
            def span(name: str) -> int:
                raw = attributes.get(name, "")
                digits = "".join(ch for ch in raw if ch.isdigit())
                return int(digits) if digits else 1
            cell = {"header": tag == "th", "colspan": max(1, span("colspan")),
                    "rowspan": span("rowspan"), "parts": [], "text": ""}
            table["row"]["cells"].append(cell)
            table["cell"] = cell
        elif tag in ("p", "div", "li", "br", "tr"):
            self.handle_data(" ")

    def handle_endtag(self, tag) -> None:
        if self.skip == tag:
            self.skip = None
            return
        table = self._top()
        if table is None:
            return
        if tag == "table":
            self._close_cell()
            self.stack.pop()
        elif tag in ("td", "th"):
            self._close_cell()
        elif tag == "tr":
            self._close_cell()
            table["row"] = None
        elif tag == "caption":
            table["in_caption"] = False

    def handle_data(self, data) -> None:
        if self.skip:
            return
        table = self._top()
        if table is None:
            return
        if table["in_caption"]:
            table["caption"].append(data)
        elif table["cell"] is not None:
            table["cell"]["parts"].append(data)


def rectangle(table: dict) -> list[list[str]]:
    """Expand the spans. Same rules as the engine, arrived at separately."""
    rows = sorted(enumerate(table["rows"]),
                  key=lambda pair: (SECTION_ORDER.get(pair[1]["section"], 1), pair[0]))
    rows = [row for _, row in rows]
    grid: dict[tuple[int, int], str] = {}
    width = 0
    for r, row in enumerate(rows):
        c = 0
        for cell in row["cells"]:
            while (r, c) in grid:
                c += 1
            rowspan = cell["rowspan"]
            if rowspan == 0:
                end = r
                while end + 1 < len(rows) and rows[end + 1]["section"] == row["section"]:
                    end += 1
                rowspan = end - r + 1
            rowspan = max(1, min(rowspan, len(rows) - r))
            for dr in range(rowspan):
                for dc in range(cell["colspan"]):
                    grid.setdefault((r + dr, c + dc), cell["text"])
            c += cell["colspan"]
            width = max(width, c)
    return [[grid.get((r, c), "") for c in range(width)] for r in range(len(rows))]


# ------------------------------------------------------------------ the checks

def cli(args: list[str]) -> str:
    out = subprocess.run(["node", os.path.join("bin", "tablegrab.js"), *args],
                         cwd=ROOT, capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise RuntimeError(f"tablegrab {' '.join(args)} exited {out.returncode}: "
                           f"{out.stderr.strip()}")
    return out.stdout


def expected(name: str) -> dict:
    with open(os.path.join(ROOT, "fixtures", "expected", name), encoding="utf-8") as handle:
        return json.load(handle)


def read(path: str) -> str:
    with open(os.path.join(ROOT, path), encoding="utf-8") as handle:
        return handle.read()


def main() -> int:
    print("independence of this checker")
    problems = prove_independence()
    if problems:
        for message in problems:
            print(f"  FAIL {message}")
        return 1

    print("\nsecond reading of the fixtures")
    for name in ("merged", "ragged", "types", "messy", "overlap", "dates"):
        want = expected(f"{name}.json")
        parser = Tables()
        parser.feed(read(os.path.join("fixtures", want["file"])))
        table = parser.tables[want["index"]]
        mine = rectangle(table)
        if mine != want["rectangle"]:
            problems.append(f"{name}: this reader and the hand-written answer disagree")
            for row_index, (got, wanted) in enumerate(zip(mine, want["rectangle"])):
                if got != wanted:
                    problems.append(f"    row {row_index} got {got} wanted {wanted}")
            if len(mine) != len(want["rectangle"]):
                problems.append(f"    {len(mine)} rows against {len(want['rectangle'])}")
        else:
            print(f"  ok    {name}: {len(mine)}x{len(mine[0])} matches the hand-written rectangle")

    print("\nthe totals row re-added from the rows above it")
    rows = list(csv.reader(io.StringIO(cli([os.path.join("fixtures", "merged.html"),
                                            "--format", "csv"]))))
    header, body = rows[0], [row for row in rows[1:] if row]
    for column in ("Revenue / 2023 (USD)", "Revenue / 2024 (USD)"):
        index = header.index(column)
        values = [float(row[index]) for row in body[:-1] if row[index]]
        total = float(body[-1][index])
        if abs(sum(values) - total) > 0.005:
            problems.append(f"{column}: the rows add to {sum(values)} and the total row says "
                            f"{total}")
        else:
            print(f"  ok    {column}: {len(values)} rows add to {total:,.2f}")

    print("\nthe values that must not be coerced")
    records = json.loads(cli([os.path.join("fixtures", "types.html"), "--format", "json"]))
    source = read(os.path.join("fixtures", "types.html"))
    for field in ("ZIP", "Version", "Phone", "Part"):
        for record in records:
            if not isinstance(record[field], str):
                problems.append(f"{field}: {record[field]!r} came back as "
                                f"{type(record[field]).__name__}")
            elif record[field] not in source:
                problems.append(f"{field}: {record[field]!r} is not in the source html")
    if not problems:
        print(f"  ok    {len(records)} rows: ZIP, Version, Phone and Part are all still text "
              f"and still match the page")
    for record in records:
        if record["ZIP"].lstrip("0") != record["ZIP"] and record["ZIP"][0] != "0":
            problems.append("a leading zero was lost")
    zips = [record["ZIP"] for record in records]
    if zips != ["07030", "02139", "10001"]:
        problems.append(f"the postcode column came back as {zips}")
    else:
        print(f"  ok    postcodes intact: {zips}")

    print("\nthe csv is a rectangle and carries no thousands separators")
    for name in ("merged.html", "ragged.html", "types.html", "messy.html"):
        text = cli([os.path.join("fixtures", name), "--format", "csv"])
        table = [row for row in csv.reader(io.StringIO(text)) if row]
        widths = {len(row) for row in table}
        if len(widths) != 1:
            problems.append(f"{name}: csv rows have widths {sorted(widths)}")
            continue
        digits = [field for row in table[1:] for field in row
                  if field.replace(",", "").replace(".", "").isdigit() and "," in field]
        if digits:
            problems.append(f"{name}: numbers still carry separators: {digits[:3]}")
        else:
            print(f"  ok    {name}: {len(table)} rows all {widths.pop()} wide, no separators left")

    print("\nthe layout tables are refused")
    refused = subprocess.run(["node", os.path.join("bin", "tablegrab.js"),
                              os.path.join("fixtures", "layout.html"), "--format", "csv"],
                             cwd=ROOT, capture_output=True, text=True, check=False)
    if refused.returncode == 0:
        problems.append("the layout table was exported without force")
    else:
        print(f"  ok    exit {refused.returncode}: {refused.stderr.strip()[:70]}")
    inner = cli([os.path.join("fixtures", "layout.html"), "--index", "1", "--format", "csv"])
    if "Quarter" not in inner:
        problems.append("the data table inside the layout table was not exported")
    else:
        print("  ok    the data table inside it exports normally")

    print("\nthe sql output round trips through sqlite")
    try:
        import sqlite3
    except ImportError:
        problems.append("sqlite3 is missing from this python, so the SQL was never executed")
        sqlite3 = None
    if sqlite3 is not None:
        connection = sqlite3.connect(":memory:")
        connection.executescript(cli([os.path.join("fixtures", "merged.html"), "--format", "sql"]))
        total = connection.execute(
            'SELECT SUM("revenue_2023") FROM "regional_revenue" WHERE "region" != ?',
            ("Total",)).fetchone()[0]
        stored = connection.execute(
            'SELECT "revenue_2023" FROM "regional_revenue" WHERE "region" = ?',
            ("Total",)).fetchone()[0]
        if total != stored:
            problems.append(f"sqlite adds the rows to {total} and the stored total is {stored}")
        else:
            print(f"  ok    sqlite executed the script and agrees the total is {total:,}")
        connection.close()

    print()
    if problems:
        for message in problems:
            print(f"FAIL {message}")
        print(f"INDEPENDENT CHECK FAILED with {len(problems)} problem(s)")
        return 1
    print("INDEPENDENT CHECK PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
