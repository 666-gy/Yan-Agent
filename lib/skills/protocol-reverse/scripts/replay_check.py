#!/usr/bin/env python3
"""Replay harness for protocol parser hypotheses.

Runs a parser command against every sample in a directory and reports
per-sample exit status. A parser hypothesis only counts as validated once
every sample passes.

Usage:
  python replay_check.py "<parser command> {sample}" <samples_dir>

The literal token {sample} is replaced with each sample's path; when the
command does not contain {sample}, the sample path is appended as the last
argument. Stdlib only.
"""

import argparse
import shlex
import subprocess
import sys
from pathlib import Path

SAMPLE_EXTENSIONS = {".bin", ".dat", ".pcap", ".cap", ".dump", ".raw", ".txt"}


def samples_in(directory):
    entries = sorted(Path(directory).iterdir())
    return [entry for entry in entries
            if entry.is_file() and (entry.suffix.lower() in SAMPLE_EXTENSIONS or not entry.suffix)]


def main():
    parser = argparse.ArgumentParser(description="Replay a parser against every sample.")
    parser.add_argument("command", help='parser command, e.g. "python my_parser.py {sample}"')
    parser.add_argument("samples_dir", help="directory containing sample files")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-sample timeout in seconds")
    args = parser.parse_args()

    samples = samples_in(args.samples_dir)
    if not samples:
        print(f"no samples found in {args.samples_dir}")
        return 1
    if "{sample}" not in args.command:
        args.command = f"{args.command} {{sample}}"

    passed, failed = 0, []
    for sample in samples:
        command = shlex.split(args.command.format(sample=str(sample)))
        try:
            result = subprocess.run(command, capture_output=True, timeout=args.timeout)
            ok = result.returncode == 0
            detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip().splitlines()
            line = detail[0] if detail else ""
        except subprocess.TimeoutExpired:
            ok, line = False, "timeout"
        except OSError as error:
            ok, line = False, str(error)
        status = "PASS" if ok else "FAIL"
        print(f"{status}  {sample.name}{('  ' + line[:120]) if line and not ok else ''}")
        if ok:
            passed += 1
        else:
            failed.append(sample.name)

    print(f"\n{passed}/{len(samples)} samples parsed")
    if failed:
        print("failed: " + ", ".join(failed))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
