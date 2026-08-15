# tablegrab

A bookmarklet that turns any HTML table into CSV, JSON, Markdown or SQL. Hover to highlight,
click to export.

Catalog task: `EXT-003`. [Demo and bookmarklet](https://jesserweigel.github.io/tablegrab/) ·
[catalog](https://github.com/JesseRWeigel/722-things-to-build)

```bash
node bin/tablegrab.js fixtures/merged.html --format csv
node bin/tablegrab.js fixtures/merged.html --format sql --table revenue
node bin/tablegrab.js fixtures/layout.html --list
```

No dependencies, no network, no build step. The engine is about 900 lines of JavaScript and the
harness around it is python and the standard library.

## Merged cells are the problem

A table with `colspan` and `rowspan` is a sparse description of a grid, and every consumer wants
the dense one. Cells are placed into the first free slot on their row, a merged cell repeats into
every slot it covers, a short row is padded on the right rather than shifted left, `rowspan="0"`
runs to the end of its section, and a `tfoot` comes out last however it was written. A header two
or three rows deep collapses into one compound name per column, so `Revenue` over `2023` becomes
`Revenue / 2023`, and a label repeated down a `rowspan` is not repeated in the name.

## Type inference, and the refusals that matter more

Thousands separators come off, currency symbols move to the column label, parenthesised negatives
become negative, and dates in six formats become ISO. The refusals are the part worth having:

- A leading zero means text. `07030` stays `07030`.
- Two dots mean text. `1.2.3` is a version, not 1.23.
- A dash inside the value means text. `555-0134` is a phone number.
- One refused value makes the whole column text, so a postcode column does not come back with
  two strings and a number in it.

Inference is decided per column rather than per cell, which is also how an ambiguous date gets
settled: `15/05/2024` can only be day-first, so `03/04/2024` in the same column is 3 April. A
column with nothing to settle it keeps the month-first default and says so in a warning.

A table that is page layout rather than data is refused, scored on nested tables,
`role="presentation"`, missing header cells and legacy attributes. `--force` overrides it.

## Verify

```bash
bash scripts/verify.sh
```

Twelve steps, and the exit code is the result. A dependency that is missing is a failure and not
a skip. The interesting ones: `scripts/sabotage.py` breaks the engine 34 different ways and
requires each break to apply, to move the fingerprint printed by `scripts/measure.py`, and only
then to be caught by the suite, with a null control first that copies the tree unchanged into a
differently named directory and requires an identical fingerprint. `scripts/check_independent.py`
reads every fixture again with a second table reader written in python and compares against the
hand-written answers, re-adds the totals row from the rows above it, and executes the generated
SQL in sqlite. `scripts/verify.sh` also loads the published page in Chrome and reads the numbers
the page produced, because the DOM adapter is the half of the code node never touches.

Every fixture has its expected rectangle written out by hand in `fixtures/expected/`, so the
tests compare against an answer a person decided rather than against whatever the code emits.

## Status

```
$ bash scripts/verify.sh
== 1. node, python and chrome
   node v24.13.0, python 3.12.3, Google Chrome 145.0.7632.45 
   standard library only, no dependencies to install
   PASS

== 2. unit suite
   ℹ tests 125
   ℹ pass 125
   ℹ fail 0
   PASS

== 3. the measurement is deterministic
   FINGERPRINT e76082ca80f235cdf2ccde4593a8f854334d6f52f48963ca935ec520800d3b26
   PASS

== 4. sabotage suite, three gates and a null control
  caught       an unknown output format is silently empty (dormant guard)

34 of 34 sabotages caught (3 of them scored as dormant guard code)
SABOTAGE SUITE PASSED
   PASS

== 5. independent recomputation, a second table reader written in python
  ok    the data table inside it exports normally

the sql output round trips through sqlite
  ok    sqlite executed the script and agrees the total is 16,561,110

INDEPENDENT CHECK PASSED
   PASS

== 6. privacy scan with planted controls
  read 42 of 42 tracked files, both control credentials detected, a NUL byte file reported rather than skipped
PRIVACY SCAN PASSED
   PASS

== 7. the published page is not stale
  docs/index.html matches the source (131 KB)
   PASS

== 8. the bookmarklet payload decodes and parses
   49145 bytes of javascript, parses, and calls activate
   PASS

== 9. the page runs the engine against the fixtures in a real browser
   ok   demo-merged#0 8x5 header=2
   ok   demo-ragged#0 7x5 header=3
   ok   demo-types#0 4x9 header=1
   ok   demo-dates#0 4x3 header=1
   ok   demo-messy#0 4x4 header=1
   ok   demo-layout#0 2x2 header=0
   ok   demo-layout#1 4x3 header=1
   ok   demo-layout#2 2x2 header=0
   OVERFLOW scroll=765 client=765 offenders=0
   SELFTEST ok=8 fail=0
   PASS

== 10. the command line tool exports and refuses
   csv, json, a refusal at exit 3 and a forced export, 0 problem(s)
   PASS

== 11. the README states what this run just did
   README carries the Status line, 125 tests and an Unfinished section, 0 problem(s)
   PASS

== 12. verify did not modify the tree it was verifying
   42 tracked files unchanged
   PASS

VERIFY PASSED: tablegrab, 12 of 12 steps
```

## Findings

**The DOM and the string parser disagreed, and the browser found it.** `Rail<sup>[1]</sup>` came
out of node as `Rail [1]` and out of the DOM as `Rail[1]`, because the node reader inserted a
space at every tag boundary and `textContent` inserts none. The browser is right: a `<sup>` is
inline and adds no space. Both readers now share one flattener that separates only on block
tags, and it is checked in both directions.

**One guard in the number parser was dead.** The sabotage suite scored it a no-op: removing the
character allowlist changed nothing, because the shape patterns underneath it already reject
everything the allowlist does. It is still there as a cheap second line, and it is not counted
as a sabotage, because an attack that changes no output proves nothing about the tests.

**A mixed column has to reach the individual cells.** Typing values one at a time gave a postcode
column holding `"07030"`, `"02139"` and the number `10001`, which is two types in one JSON field
and worse than either answer alone.

## Unfinished

- **`src/dom.js` is not covered by the sabotage suite.** The fingerprint comes from node, so an
  attack on the DOM adapter changes nothing measurable and cannot be scored. It is covered by the
  self-check that runs in the browser, which is a weaker guarantee than the other 34 attacks.
- **Decimal separators are guessed by shape.** `1.234` is read as a decimal and `1,234` as a
  thousands group. `1.234.567` and `1.234.567,89` are read as European. There is no locale
  option and no per-document sniffing.
- **Indian digit grouping is not supported.** `1,23,456` stays text.
- **Only two date orders.** Numeric dates are month-first by default and day-first with
  `--day-first`, resolved per column where the column settles it. Times, timezones, two digit
  years and month-only values are all text.
- **The layout table heuristic is scored, not measured.** It is right on the three fixtures here
  and has never been run against a corpus of real pages, so the threshold of 3 is a guess.
- **Copy uses `document.execCommand`,** which is deprecated. The async clipboard API needs a
  permission prompt on some sites and a secure context, and falls back to nothing when refused.
- **The bookmarklet is 49 KB in a `javascript:` URL.** Sites with a strict CSP will refuse to run
  it, and there is no extension packaging as a fallback.
- **Nested tables are separate exports.** Picking the outer one gives you the outer one, with the
  inner table's text left out of the cell rather than flattened into it.

MIT licensed.
