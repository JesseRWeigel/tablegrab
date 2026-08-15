#!/usr/bin/env python3
"""Scan every tracked file for anything that should not be public, with a control that proves it reads.

A scanner that opens no files is silent in exactly the same way as a clean tree, so this one
plants a credential-shaped string in a temporary file and fails unless it finds it. It also fails
when almost nothing is tracked, because before the first commit `git ls-files` returns nothing and
a scan over zero files passes without opening one.

The patterns are assembled from fragments at runtime so this file does not match its own pattern
list, which is the mistake that has quietly disarmed several checkers in this fleet.

A file containing a NUL byte is a failure rather than a skip. git and grep call such a file binary
and skip it, and a scan that skips a file reports the same clean result as a scan that read it.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Assembled, never written whole. A literal here would be found in this file on every run.
PATTERNS = [
    ("aws access key", re.compile("AKIA" + r"[0-9A-Z]{16}")),
    ("openai style key", re.compile("sk" + "-" + r"[A-Za-z0-9]{20,}")),
    ("github token", re.compile("gh" + "[pousr]" + "_" + r"[A-Za-z0-9]{30,}")),
    ("private key block", re.compile("-----BEGIN " + r"[A-Z ]*PRIVATE KEY-----")),
    ("bearer header", re.compile(r"[Aa]uthorization:\s*[Bb]earer\s+" + r"[A-Za-z0-9._\-]{16,}")),
    ("password assignment", re.compile(r"(?i)\b(password|passwd|secret)\s*[=:]\s*['\"][^'\"]{6,}")),
    ("home path", re.compile(r"/home/[a-z][a-z0-9_-]+/")),
    ("personal email", re.compile(r"[A-Za-z0-9._%+-]+@(?!example|test|vendor)"
                                  r"[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
]

# This repository tracks no binaries at all.
ALLOWED_BINARY: set[str] = set()


def tracked_files() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True,
                         check=False)
    return [line for line in out.stdout.splitlines() if line.strip()]


def scan_text(name: str, text: str) -> list[str]:
    findings = []
    for label, pattern in PATTERNS:
        for match in pattern.finditer(text):
            findings.append(f"{name}: {label}: {match.group(0)[:48]}")
    return findings


def scan_file(path: str, name: str) -> tuple[list[str], bool]:
    extension = os.path.splitext(name)[1].lower()
    try:
        with open(path, "rb") as handle:
            blob = handle.read()
    except OSError as exc:
        return [f"{name}: could not be read: {exc}"], False
    if b"\x00" in blob:
        if extension in ALLOWED_BINARY:
            return [], False
        return [f"{name}: contains a NUL byte, so every scan of it is blind"], False
    return scan_text(name, blob.decode("utf-8", errors="replace")), True


def main() -> int:
    files = tracked_files()
    problems: list[str] = []
    read = 0

    if len(files) < 10:
        print(f"FAIL only {len(files)} tracked file(s). A scan over nothing passes trivially.")
        return 1

    for name in files:
        findings, opened = scan_file(os.path.join(ROOT, name), name)
        read += 1 if opened else 0
        problems.extend(findings)

    # The controls. A scanner that cannot find a planted key cannot find a real one either.
    with tempfile.TemporaryDirectory() as tmp:
        planted = os.path.join(tmp, "control.txt")
        with open(planted, "w", encoding="utf-8") as handle:
            handle.write("aws_key = " + "AKIA" + "1234567890ABCDEF" + "\n")
            handle.write("token = " + "gh" + "p" + "_" + "A" * 36 + "\n")
        found, _ = scan_file(planted, "control.txt")
        if len(found) < 2:
            print("FAIL the planted control credentials were not both detected, so this scan "
                  "proves nothing about the files it just read")
            return 1
        nul = os.path.join(tmp, "control.bin")
        with open(nul, "wb") as handle:
            # Assembled here too. A complete credential shaped literal in this file
            # would be a finding in its own scan, and GitHub push protection rejects
            # one on sight whatever it is for.
            handle.write(b"AKIA" + b"1234567890ABCDEF" + b"\x00")
        nul_findings, opened = scan_file(nul, "control.bin")
        if opened or not nul_findings:
            print("FAIL a file with a NUL byte was skipped quietly rather than reported")
            return 1

    print(f"  read {read} of {len(files)} tracked files, both control credentials detected, "
          f"a NUL byte file reported rather than skipped")
    if problems:
        for message in problems:
            print(f"  FAIL {message}")
        print(f"PRIVACY SCAN FAILED with {len(problems)} finding(s)")
        return 1
    print("PRIVACY SCAN PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
