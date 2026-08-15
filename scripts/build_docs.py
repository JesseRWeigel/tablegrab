#!/usr/bin/env python3
"""Generate docs/index.html: the bundle, the bookmarklet, the demo tables and a self-check.

The page carries the same fixtures the node tests use and the same hand-written answers, and
checks itself in the browser on load. That covers the half of the code node never touches, the
DOM adapter, and it fails loudly if the bundle does not parse, which a unit test cannot notice.

`--check` rebuilds and compares, so a stale published page is a failure rather than a surprise.
"""

from __future__ import annotations

import json
import os
import re
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")
FIXTURES = os.path.join(ROOT, "fixtures")
EXPECTED = os.path.join(FIXTURES, "expected")

# Order is fixed so the bundle is byte for byte the same on every run.
MODULES = ["parse", "grid", "infer", "detect", "emit", "dom", "ui", "index"]

DEMOS = [
    ("merged", "Merged cells", "A header two rows deep, a group header over two columns, a row "
                               "label spanning three rows, and a tfoot written before the tbody."),
    ("ragged", "Ragged and three deep", "No thead at all, one row missing two cells, and a "
                                        "rowspan=\"0\" running to the end of the section."),
    ("types", "What must not be coerced", "Version strings, phone numbers and a postcode with a "
                                          "leading zero stay text. The money and percentages do not."),
    ("dates", "Ambiguous dates", "15/05/2024 can only be day-first, which settles the two beside "
                                 "it. The Deadline column has nothing to settle it and says so."),
    ("messy", "Awkward cells", "A comma, a quote, an apostrophe, a script tag and two columns "
                               "with the same name."),
    ("layout", "Not data", "Page furniture from the table-layout era, with a real data table "
                           "inside it. The outer two are refused."),
]

STYLE = """
:root{color-scheme:light dark;--bg:#fbfaf8;--fg:#191a1c;--muted:#5d626a;--line:#e4e5e8;
  --card:#fff;--accent:#b23a22}
@media (prefers-color-scheme:dark){:root{--bg:#131416;--fg:#e9e7e3;--muted:#8f959d;
  --line:#25282c;--card:#191b1e;--accent:#e2755a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:16px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:54rem;margin:0 auto;padding:3rem 1.25rem 4rem}
h1{font-size:clamp(1.9rem,5vw,2.6rem);margin:0 0 .3rem;letter-spacing:-.03em}
h2{font-size:1.12rem;margin:2.4rem 0 .7rem;padding-bottom:.35rem;border-bottom:1px solid var(--line)}
h3{font-size:.95rem;margin:1.6rem 0 .3rem}
p{color:var(--muted);max-width:44rem}
a{color:var(--accent)}
.grab{display:inline-block;border:1px solid var(--line);background:var(--card);color:var(--fg);
  border-radius:6px;padding:.35rem .8rem;font-weight:600;text-decoration:none}
button{font:inherit;border:1px solid var(--line);background:var(--card);color:var(--fg);
  border-radius:6px;padding:.35rem .8rem;cursor:pointer}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}
table{border-collapse:collapse;font-size:.86rem;min-width:100%}
th,td{text-align:left;padding:.35rem .6rem;border:1px solid var(--line);vertical-align:top;
  white-space:nowrap}
caption{text-align:left;padding:.4rem .6rem;color:var(--muted);font-size:.8rem}
pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:.9rem;
  overflow-x:auto;font-size:.8rem;line-height:1.5}
code{background:var(--card);border:1px solid var(--line);border-radius:3px;padding:.05rem .3rem;
  font-size:.85em}
footer{margin-top:3rem;color:var(--muted);font-size:.85rem}
"""


def read(path: str) -> str:
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def bundle() -> str:
    """One IIFE with a tiny require shim. No build tool, no dependency."""
    parts = [
        "(function(global){\n"
        "var __defs = {}, __cache = {};\n"
        "function require(name){\n"
        "  var key = String(name).replace(/^\\.\\//, '');\n"
        "  if (__cache[key]) return __cache[key].exports;\n"
        "  if (!__defs[key]) throw new Error('tablegrab: no module ' + key);\n"
        "  var module = { exports: {} };\n"
        "  __cache[key] = module;\n"
        "  __defs[key](module, module.exports, require);\n"
        "  return module.exports;\n"
        "}\n"
    ]
    for name in MODULES:
        source = read(os.path.join(SRC, f"{name}.js"))
        parts.append(f"__defs['{name}'] = function(module, exports, require){{\n{source}\n}};\n")
    parts.append(
        "var api = require('index');\n"
        "api.activate = require('ui').activate;\n"
        "global.TableGrab = api;\n"
        "})(typeof window !== 'undefined' ? window : this);\n"
    )
    return "".join(parts)


def table_blocks(html: str) -> list[str]:
    """Every top level table element in a fixture, with its nested tables intact."""
    blocks = []
    index = 0
    while True:
        start = html.find("<table", index)
        if start == -1:
            return blocks
        depth = 0
        cursor = start
        while cursor < len(html):
            token = re.compile(r"</?table\b", re.I).search(html, cursor)
            if token is None:
                return blocks
            if token.group(0).lower().startswith("</"):
                depth -= 1
                cursor = html.find(">", token.end()) + 1
                if depth == 0:
                    blocks.append(html[start:cursor])
                    index = cursor
                    break
            else:
                depth += 1
                cursor = html.find(">", token.end()) + 1
        else:
            return blocks


def expectations() -> list[dict]:
    """The hand-written answers, reshaped for the in-page check."""
    out = []
    for name in ["merged", "ragged", "types", "dates", "messy", "overlap"]:
        want = json.loads(read(os.path.join(EXPECTED, f"{name}.json")))
        if name == "overlap":
            continue
        out.append({
            "container": f"demo-{name}",
            "index": want["index"],
            "columns": want["columns"],
            "types": want["types"],
            "values": want["values"],
            "isData": want["isData"],
        })
    layout = json.loads(read(os.path.join(EXPECTED, "layout.json")))
    for entry in layout["tables"]:
        out.append({
            "container": "demo-layout",
            "index": entry["index"],
            "columns": entry.get("columns"),
            "types": entry.get("types"),
            "values": entry.get("values"),
            "isData": entry["isData"],
        })
    return out


SELFTEST = """
(function(){
  var report = document.getElementById('selftest');
  var lines = [], ok = 0, fail = 0;
  function same(a, b){ return JSON.stringify(a) === JSON.stringify(b); }
  EXPECT.forEach(function(spec){
    var name = spec.container + '#' + spec.index;
    try {
      var tables = document.querySelectorAll('#' + spec.container + ' table');
      var table = tables[spec.index];
      if (!table) throw new Error('no table');
      var grid = TableGrab.buildGrid(TableGrab.fromDom(table), {});
      var verdict = TableGrab.classify(grid);
      var problems = [];
      if (verdict.isData !== spec.isData) problems.push('verdict ' + verdict.isData);
      if (spec.columns) {
        var analysis = TableGrab.analyse(grid, {});
        var values = analysis.rows.map(function(row){
          return row.map(function(cell){ return cell.type === 'empty' ? null : cell.value; });
        });
        if (!same(grid.columns, spec.columns)) problems.push('columns ' + JSON.stringify(grid.columns));
        if (!same(analysis.columns.map(function(c){ return c.type; }), spec.types)) {
          problems.push('types ' + JSON.stringify(analysis.columns.map(function(c){ return c.type; })));
        }
        if (!same(values, spec.values)) problems.push('values ' + JSON.stringify(values));
      }
      if (problems.length) { fail++; lines.push('FAIL ' + name + ': ' + problems.join(' | ')); }
      else { ok++; lines.push('ok   ' + name + ' ' + grid.height + 'x' + grid.width
        + ' header=' + grid.headerRows); }
    } catch (err) {
      fail++;
      lines.push('FAIL ' + name + ': ' + (err && err.message ? err.message : err));
    }
  });
  // Anything escaping the page sideways, measured rather than eyeballed. Content scrolling
  // inside its own container is correct, so those subtrees are skipped.
  var docWidth = document.documentElement.clientWidth;
  var offenders = [];
  var all = document.querySelectorAll('body *');
  for (var i = 0; i < all.length; i++) {
    var node = all[i], scrolls = false, up = node.parentNode;
    while (up && up.nodeType === 1 && up !== document.body) {
      var flow = getComputedStyle(up).overflowX;
      if (flow === 'auto' || flow === 'scroll') { scrolls = true; break; }
      up = up.parentNode;
    }
    if (scrolls) continue;
    if (node.getBoundingClientRect().right > docWidth + 1) {
      offenders.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : ''));
    }
  }
  lines.push('OVERFLOW scroll=' + document.documentElement.scrollWidth + ' client=' + docWidth
    + ' offenders=' + offenders.length + (offenders.length ? ' ' + offenders.join(',') : ''));
  lines.push('SELFTEST ok=' + ok + ' fail=' + fail);
  report.textContent = lines.join('\\n');
  document.getElementById('activate').addEventListener('click', function(){
    TableGrab.activate({});
  });
})();
"""


def build_page() -> str:
    code = bundle()
    # Only the characters that would end the attribute or the tag are escaped. Escaping
    # everything triples the size of the href for no benefit.
    payload = "javascript:" + quote(f"(function(){{{code}\nwindow.TableGrab.activate({{}});}})();",
                                    safe="!$&'()*+,-./:;=?@_~[]{}|^\\")
    demos = []
    for name, heading, note in DEMOS:
        blocks = table_blocks(read(os.path.join(FIXTURES, f"{name}.html")))
        if name == "layout":
            # The inner data table is inside the outer one, so only the top level blocks go in.
            blocks = [block for block in blocks]
        wrapped = "".join(f'<div class="scroll">{block}</div>' for block in blocks)
        demos.append(f'<h3>{heading}</h3>\n<p>{note}</p>\n<div id="demo-{name}">{wrapped}</div>')

    expect = json.dumps(expectations(), sort_keys=True, separators=(",", ":"))
    script = f"var EXPECT = {expect};\n{code}\n{SELFTEST}".replace("</script", "<\\/script")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>tablegrab</title>
<meta name="description" content="A bookmarklet that turns any HTML table into CSV, JSON, Markdown or SQL.">
<style>{STYLE}</style></head><body><main>

<h1>tablegrab</h1>
<p>Drag this to your bookmarks bar, then click it on any page with a table. Hover to highlight,
click to export.</p>
<p><a class="grab" href="{payload}">tablegrab</a>
&nbsp; <button id="activate">or run it here</button></p>

<h2>What it does</h2>
<p>Merged cells are the whole problem. A table with <code>colspan</code> and <code>rowspan</code>
is a sparse description of a grid, and CSV wants the dense one, so every merged cell is repeated
into the slots it covers and a short row is padded rather than shifted. A header two or three
rows deep collapses into one compound name per column: <code>Revenue / 2023</code>.</p>
<p>Numbers lose their thousands separators and currency symbols, dates become ISO, and the
values that only look numeric stay text. A postcode of <code>07030</code> that comes back as
7030 is the failure this is built around, so version strings, phone numbers, part codes and
anything with a leading zero are refused, and one refused value makes the whole column text.</p>
<p>Output is CSV, JSON, Markdown, or a <code>CREATE TABLE</code> and <code>INSERT</code> pair.
No network, no dependency, nothing leaves the page.</p>

<h2>Demo tables</h2>
<p>These are the test fixtures. The check at the bottom of this page runs against them in your
browser, through the same code the bookmarklet uses.</p>
{"".join(demos)}

<h2>Self-check</h2>
<p>Run on load, in this browser, against answers written out by hand before the code existed.</p>
<pre id="selftest">the script did not run</pre>

<footer><a href="https://github.com/JesseRWeigel/tablegrab">tablegrab</a> is MIT licensed.
One of a <a href="https://github.com/JesseRWeigel/722-things-to-build">catalog</a> of build
ideas. This page is generated from the source, and the build fails if it drifts.</footer>
</main>
<script>{script}</script>
</body></html>
"""


def main() -> int:
    path = os.path.join(ROOT, "docs", "index.html")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    html = build_page()
    previous = read(path) if os.path.exists(path) else None
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(html)
    if "--check" in sys.argv:
        if previous is None:
            print("  FAIL docs/index.html did not exist")
            return 1
        if previous != html:
            print("  FAIL docs/index.html is stale, rebuild it with scripts/build_docs.py")
            return 1
        print(f"  docs/index.html matches the source ({len(html) // 1024} KB)")
    else:
        print(f"wrote docs/index.html ({len(html) // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
