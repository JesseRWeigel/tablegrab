#!/usr/bin/env python3
"""Deterministic fingerprint of what the engine does. Measurements, never verdicts.

Nothing here says pass or fail. It prints the shape of every fixture table, the type of every
column, the inference of a list of individual values, and a digest of each of the four outputs.
The sabotage suite compares this against a baseline, so anything a break could plausibly touch
has to be visible here.

No absolute path is printed, so a copy of this tree in a differently named directory produces a
byte identical fingerprint. That is what makes the null control mean something.
"""

from __future__ import annotations

import hashlib
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import tablegrab_bridge as engine  # noqa: E402

FIXTURES = ["dates.html", "layout.html", "merged.html", "messy.html", "overlap.html",
            "ragged.html", "types.html"]

# Values that must be read as numbers or dates, and values that must survive as text. The
# second half is the point: a converter that eats a leading zero is the classic failure.
PROBES = [
    "1,234,567", "1 234 567", "1.234.567", "1.234.567,89", "$1,234.56", "€1.234,56",
    "(1,234.56)", "-15.5", "+12.5%", "0", "0.5", "1.234", "1,5", "1234 USD",
    "2024-01-15", "15/02/2024", "03/04/2024", "3 March 2024", "May 6, 2024", "31-12-2024",
    "2023-02-29", "32/01/2024",
    "1.2.3", "10.4.1", "192.168.0.1", "07030", "02139", "007", "555-0134", "555-123-4567",
    "X-100", "1,234-5,678", "12 items", "2024 Q1", "1e6", "1,23,456",
    "", "-", "n/a", "—",
]

FORMATS = ["csv", "json", "md", "sql"]


def short(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def main() -> int:
    lines: list[str] = []

    lines.append("=== tables")
    for name in FIXTURES:
        path = os.path.join("fixtures", name)
        listing = engine.listing(path)
        lines.append(f"  {name} tables={len(listing)}")
        for entry in listing:
            lines.append(f"    {entry}")

    lines.append("=== grids")
    for name in FIXTURES:
        path = os.path.join("fixtures", name)
        for index in range(len(engine.listing(path))):
            code, message = engine.refusal(path, index)
            if code != 0:
                lines.append(f"  {name}#{index} refused exit={code} {short(message)} "
                             f"{message[:60]}")
                continue
            grid = engine.grid(path, index)
            lines.append(f"  {name}#{index} {grid['height']}x{grid['width']} "
                         f"header={grid['headerRows']} caption={grid['caption']!r} "
                         f"foot={grid['footRows']} ragged={grid['ragged']} "
                         f"notes={grid['notes']}")
            for column in grid["columns"]:
                lines.append(f"    col {column['name']!r} -> {column['label']!r} "
                             f"{column['type']} int={column['integer']} "
                             f"cur={column['currency']} pct={column['percent']} "
                             f"warn={column['warnings']}")
            for row in grid["rectangle"]:
                lines.append(f"    raw {row}")
            for row in grid["values"]:
                lines.append(f"    val {row}")

    lines.append("=== outputs")
    for name in FIXTURES:
        path = os.path.join("fixtures", name)
        for index in range(len(engine.listing(path))):
            if engine.refusal(path, index)[0] != 0:
                continue
            for fmt in FORMATS:
                text = engine.emit(path, fmt, index)
                lines.append(f"  {name}#{index} {fmt} chars={len(text)} "
                             f"lines={text.count(chr(10))} sha={short(text)}")

    lines.append("=== dates read day first")
    grid = engine.grid(os.path.join("fixtures", "dates.html"), 0, ["--day-first"])
    for row in grid["values"]:
        lines.append(f"  val {row}")

    lines.append("=== single values")
    for cell in engine.infer(PROBES):
        lines.append(f"  {cell['raw']!r} -> {cell['type']} {cell['value']!r} "
                     f"ambiguous={cell['ambiguous']} currency={cell['currency']} "
                     f"percent={cell['percent']}")

    lines.append("=== forced export of a layout table")
    forced = engine.emit(os.path.join("fixtures", "layout.html"), "csv", 0, ["--force"])
    lines.append(f"  chars={len(forced)} sha={short(forced)}")

    body = "\n".join(lines)
    print(body)
    print(f"\nFINGERPRINT {hashlib.sha256(body.encode('utf-8')).hexdigest()}")
    print(f"LINES {len(lines)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
