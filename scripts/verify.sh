#!/usr/bin/env bash
# The verify command. Its exit code is the result.
#
# Nothing here prints success for a step it did not run. A missing dependency is a FAILURE and
# not a skip, because a skipped check and a passing check look identical in a log a week later.
#
# The tree is digested before and after. A verify run that edits the repository can pass on a
# later run for reasons an earlier run created, which is indistinguishable from working.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

STEP=0
FAILED=0
CHROME="${CHROME:-/usr/bin/google-chrome}"
TOTAL=12   # asserted against STEP at the end, so the README check can name it early

step() {
  STEP=$((STEP + 1))
  printf '\n== %d. %s\n' "$STEP" "$1"
}

check() {
  if [ "$1" -eq 0 ]; then
    printf '   PASS\n'
  else
    printf '   FAIL (exit %d)\n' "$1"
    FAILED=$((FAILED + 1))
  fi
}

digest() {
  python3 - <<'EOF'
import hashlib, os, subprocess
out = subprocess.run(["git", "ls-files"], capture_output=True, text=True)
digest = hashlib.sha256()
for name in sorted(out.stdout.split()):
    if os.path.exists(name):
        with open(name, "rb") as handle:
            digest.update(name.encode())
            digest.update(handle.read())
print(digest.hexdigest())
EOF
}

# ---------------------------------------------------------------- interpreters and dependencies

step "node, python and chrome"
if ! command -v node >/dev/null; then
  printf '   FAIL node is not on PATH. Install node 18 or newer; without it nothing below runs.\n'
  exit 1
fi
if ! command -v python3 >/dev/null; then
  printf '   FAIL python3 is not on PATH. The harness around the engine is python.\n'
  exit 1
fi
if [ ! -x "$CHROME" ]; then
  printf '   FAIL no chrome at %s. Set CHROME=<path> or install it; the page self-check is the\n' "$CHROME"
  printf '        only thing that runs the DOM adapter and the bundle in a real browser.\n'
  exit 1
fi
printf '   node %s, python %s, %s\n' "$(node --version)" \
  "$(python3 -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')" \
  "$("$CHROME" --version)"
printf '   standard library only, no dependencies to install\n'
check 0

BEFORE="$(digest)"

# ---------------------------------------------------------------- the checks

step "unit suite"
TESTOUT="$(mktemp)"
node --test "tests/*.test.js" >"$TESTOUT" 2>&1
TESTCODE=$?
grep -E '^. (tests|pass|fail) ' "$TESTOUT" | sed 's/^/   /'
check "$TESTCODE"
PASSCOUNT="$(grep -Eo '^. pass [0-9]+' "$TESTOUT" | grep -Eo '[0-9]+' | head -1)"
rm -f "$TESTOUT"

step "the measurement is deterministic"
A="$(python3 scripts/measure.py | grep '^FINGERPRINT')"
B="$(python3 scripts/measure.py | grep '^FINGERPRINT')"
if [ -n "$A" ] && [ "$A" = "$B" ]; then
  printf '   %s\n' "$A"
  check 0
else
  printf '   two runs disagreed:\n     %s\n     %s\n' "$A" "$B"
  check 1
fi

step "sabotage suite, three gates and a null control"
python3 scripts/sabotage.py 2>&1 | tail -4
check "${PIPESTATUS[0]}"

step "independent recomputation, a second table reader written in python"
python3 scripts/check_independent.py 2>&1 | tail -6
check "${PIPESTATUS[0]}"

step "privacy scan with planted controls"
python3 scripts/privacy_scan.py
check $?

step "the published page is not stale"
python3 scripts/build_docs.py --check
check $?

step "the bookmarklet payload decodes and parses"
PAYLOAD="$(mktemp -t tablegrab-payload-XXXXXX.js)"
python3 - <<'EOF' > "$PAYLOAD"

import html, re, sys, urllib.parse
source = open("docs/index.html", encoding="utf-8").read()
match = re.search(r'href="(javascript:[^"]+)"', source)
if match is None:
    print("//NOPAYLOAD")
    sys.exit(0)
sys.stdout.write(urllib.parse.unquote(html.unescape(match.group(1))[len("javascript:"):]))
EOF
if node --check "$PAYLOAD" 2>/dev/null \
  && grep -q 'TableGrab.activate' "$PAYLOAD" \
  && [ "$(wc -c < "$PAYLOAD")" -gt 20000 ]; then
  printf '   %s bytes of javascript, parses, and calls activate\n' \
    "$(wc -c < "$PAYLOAD")"
  check 0
else
  printf '   the href in docs/index.html is not a complete, parseable bookmarklet\n'
  check 1
fi
rm -f "$PAYLOAD"

step "the page runs the engine against the fixtures in a real browser"
DOM="$(mktemp)"
timeout 90 "$CHROME" --headless --no-sandbox --disable-gpu --virtual-time-budget=5000 \
  --dump-dom "file://$ROOT/docs/index.html" >"$DOM" 2>/dev/null
CHROMECODE=$?
python3 - "$DOM" <<'EOF'
import html, re, sys
body = open(sys.argv[1], encoding="utf-8").read()
match = re.search(r'<pre id="selftest">(.*?)</pre>', body, re.S)
if match is None:
    print("   no selftest block in the page at all, so the script never ran")
    sys.exit(1)
report = html.unescape(match.group(1)).strip()
for line in report.splitlines():
    print(f"   {line}")
ok = re.search(r"SELFTEST ok=(\d+) fail=(\d+)", report)
over = re.search(r"OVERFLOW scroll=(\d+) client=(\d+) offenders=(\d+)", report)
problems = []
if ok is None:
    problems.append("the self-check never reached its last line")
else:
    if int(ok.group(2)):
        problems.append(f"{ok.group(2)} table(s) came out wrong in the browser")
    if int(ok.group(1)) < 8:
        problems.append(f"only {ok.group(1)} tables were checked, expected at least 8")
if over is None:
    problems.append("no overflow measurement")
elif int(over.group(3)) or int(over.group(1)) > int(over.group(2)):
    problems.append(f"content escapes the page sideways: {over.group(0)}")
for message in problems:
    print(f"   {message}")
sys.exit(1 if problems else 0)
EOF
DOMCODE=$?
rm -f "$DOM"
if [ "$CHROMECODE" -ne 0 ]; then check "$CHROMECODE"; else check "$DOMCODE"; fi

step "the command line tool exports and refuses"
python3 - <<'EOF'
import json, subprocess, sys

def run(args):
    return subprocess.run(["node", "bin/tablegrab.js", *args], capture_output=True, text=True)

problems = []
csv = run(["fixtures/merged.html", "--format", "csv"])
if csv.returncode != 0:
    problems.append(f"csv export failed: {csv.stderr.strip()}")
elif "1234567" not in csv.stdout or "$" in csv.stdout:
    problems.append("the csv still carries the currency symbol or the separators")

records = run(["fixtures/types.html", "--format", "json"])
if records.returncode != 0:
    problems.append(f"json export failed: {records.stderr.strip()}")
else:
    rows = json.loads(records.stdout)
    if [row["ZIP"] for row in rows] != ["07030", "02139", "10001"]:
        problems.append(f'postcodes came back as {[row["ZIP"] for row in rows]}')

refused = run(["fixtures/layout.html", "--format", "csv"])
if refused.returncode == 0:
    problems.append("the layout table exported without force")
forced = run(["fixtures/layout.html", "--format", "csv", "--force"])
if forced.returncode != 0 or "Acme" not in forced.stdout:
    problems.append("force did not override the refusal")

print(f"   csv, json, a refusal at exit {refused.returncode} and a forced export, "
      f"{len(problems)} problem(s)")
for message in problems:
    print(f"   {message}")
sys.exit(1 if problems else 0)
EOF
check $?

step "the README states what this run just did"
python3 - "$PASSCOUNT" "$TOTAL" <<'EOF'
import re, sys
count, total = sys.argv[1], sys.argv[2]
text = open("README.md", encoding="utf-8").read()
outside = re.sub(r"```.*?```", "", text, flags=re.S)
problems = []
if "## Status" not in text:
    problems.append("no Status section")
if f"VERIFY PASSED: tablegrab, {total} of {total} steps" not in text:
    problems.append("the Status section does not carry this script's success line")
if count and f"pass {count}" not in text:
    problems.append(f"the pasted transcript does not show the current test count ({count})")
if "## Unfinished" not in text:
    problems.append("no Unfinished section")
for marker in ("TODO", "NOT YET VERIFIED", "replace with a real description"):
    if marker in outside:
        problems.append(f"scaffold marker left outside a code block: {marker}")
print(f"   README carries the Status line, {count} tests and an Unfinished section, "
      f"{len(problems)} problem(s)")
for message in problems:
    print(f"   {message}")
sys.exit(1 if problems else 0)
EOF
check $?

# ---------------------------------------------------------------- the tree must be unchanged

step "verify did not modify the tree it was verifying"
AFTER="$(digest)"
if [ "$BEFORE" = "$AFTER" ]; then
  printf '   %s tracked files unchanged\n' "$(git ls-files | wc -l)"
  check 0
else
  printf '   the tree changed during verification\n     before %s\n     after  %s\n' \
    "$BEFORE" "$AFTER"
  check 1
fi

# ---------------------------------------------------------------- result

printf '\n'
if [ "$STEP" -ne "$TOTAL" ]; then
  printf 'VERIFY FAILED: %d steps ran and the script says it has %d\n' "$STEP" "$TOTAL"
  exit 1
fi
if [ "$FAILED" -eq 0 ]; then
  printf 'VERIFY PASSED: tablegrab, %d of %d steps\n' "$STEP" "$STEP"
  exit 0
fi
printf 'VERIFY FAILED: %d of %d steps failed\n' "$FAILED" "$STEP"
exit 1
