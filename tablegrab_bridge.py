"""Run the node engine from python, with relative paths only.

The engine is JavaScript because the deliverable is a bookmarklet. The harness around it is
python, so this is the seam. Every command runs with the repository as its working directory and
is given relative paths, because an absolute path in the output would put the working directory
into the fingerprint and hand gate 2 of the sabotage suite a free pass.

scripts/check_independent.py deliberately does not import this file.
"""

from __future__ import annotations

import json
import os
import subprocess

ROOT = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join("bin", "tablegrab.js")
PROBE = os.path.join("scripts", "probe.js")


class EngineError(RuntimeError):
    pass


def _run(args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["node", *args], cwd=ROOT, capture_output=True, text=True, check=False,
    )


def grid(path: str, index: int = 0, extra: list[str] | None = None) -> dict:
    """The full analysis of one table, as the CLI reports it."""
    out = _run([CLI, path, "--index", str(index), "--format", "grid", *(extra or [])])
    if out.returncode != 0:
        raise EngineError(f"grid {path}#{index} failed ({out.returncode}): {out.stderr.strip()}")
    return json.loads(out.stdout)


def emit(path: str, fmt: str, index: int = 0, extra: list[str] | None = None) -> str:
    out = _run([CLI, path, "--index", str(index), "--format", fmt, *(extra or [])])
    if out.returncode != 0:
        raise EngineError(f"emit {fmt} {path}#{index} failed ({out.returncode}): "
                          f"{out.stderr.strip()}")
    return out.stdout


def refusal(path: str, index: int = 0) -> tuple[int, str]:
    """Exit code and message for a table the engine may refuse."""
    out = _run([CLI, path, "--index", str(index), "--format", "csv"])
    return out.returncode, (out.stderr or out.stdout).strip()


def listing(path: str) -> list[str]:
    out = _run([CLI, path, "--list"])
    if out.returncode != 0:
        raise EngineError(f"list {path} failed ({out.returncode}): {out.stderr.strip()}")
    return [line for line in out.stdout.splitlines() if line.strip()]


def infer(values: list[str]) -> list[dict]:
    """One inference per value, with no column context around it."""
    out = _run([PROBE, json.dumps(values)])
    if out.returncode != 0:
        raise EngineError(f"probe failed ({out.returncode}): {out.stderr.strip()}")
    return json.loads(out.stdout)


def node_version() -> str:
    out = subprocess.run(["node", "--version"], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise EngineError("node is not on PATH")
    return out.stdout.strip()
