#!/usr/bin/env python3
"""Per-offset field statistics for protocol reverse engineering.

Reads binary samples and reports, for every byte offset inside the record
stride: distinct value count, Shannon entropy, the most common value, and a
constant/low-entropy flag. Classic PRE signal: constant offsets are length
prefixes / magic / version fields, low-entropy offsets are counters, enums
and flags, high-entropy offsets are payload or checksums.

Usage:
  python field_stats.py <file> [more files...] [--record-length N] [--limit N]

Without --record-length the script autocorrelates candidate strides 1..64
and picks the stride with the most constant offsets (best structural fit).
Stdlib only.
"""

import argparse
import math
import sys
from collections import Counter


def entropy(values):
    if not values:
        return 0.0
    counts = Counter(values)
    total = len(values)
    return -sum((c / total) * math.log2(c / total) for c in counts.values())


def read_records(paths, stride):
    columns = []
    for path in paths:
        with open(path, "rb") as handle:
            data = handle.read()
        for start in range(0, len(data) - stride + 1, stride):
            record = data[start:start + stride]
            if len(record) == stride:
                columns.append(record)
    return columns


def infer_stride(paths, max_stride=64):
    best_stride, best_score = None, -1.0
    for stride in range(1, max_stride + 1):
        columns = read_records(paths, stride)
        if len(columns) < 4:
            continue
        constant = sum(1 for offset in range(stride)
                       if len({record[offset] for record in columns}) == 1)
        score = constant / stride
        if score > best_score:
            best_stride, best_score = stride, score
    return best_stride


def main():
    parser = argparse.ArgumentParser(description="Per-offset field statistics.")
    parser.add_argument("files", nargs="+", help="binary sample files")
    parser.add_argument("--record-length", type=int, default=0, help="record stride in bytes (0 = infer)")
    parser.add_argument("--limit", type=int, default=0, help="print only the first N offsets (0 = all)")
    args = parser.parse_args()

    stride = args.record_length
    if stride <= 0:
        stride = infer_stride(args.files)
        if not stride:
            print("no usable stride found; pass --record-length explicitly")
            return 1
        print(f"inferred record length: {stride}")

    columns = read_records(args.files, stride)
    if not columns:
        print("samples too small for the chosen stride")
        return 1

    print(f"samples: {len(args.files)}  records: {len(columns)}  stride: {stride}")
    print(f"{'off':>4}  {'distinct':>8}  {'entropy':>7}  {'common':>6}  flags")
    for offset in range(stride):
        values = [record[offset] for record in columns]
        distinct = len(set(values))
        entropy_value = entropy(values)
        common, count = Counter(values).most_common(1)[0]
        flags = []
        if distinct == 1:
            flags.append("CONSTANT")
        elif entropy_value < 0.5:
            flags.append("low-entropy")
        elif entropy_value > 6.5:
            flags.append("high-entropy")
        flag_text = f"  {'/'.join(flags)}" if flags else ""
        if args.limit and offset >= args.limit:
            print("  ...")
            break
        print(f"{offset:>4}  {distinct:>8}  {entropy_value:>7.3f}  0x{common:02x}    {flag_text.lstrip()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
