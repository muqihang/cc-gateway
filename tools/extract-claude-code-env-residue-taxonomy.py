#!/usr/bin/env python3
"""Extract Claude Code env-residue taxonomy from a local JS bundle or native binary.

Safe default output intentionally avoids printing raw domains/URLs. It reports
counts, sentinel presence, hashes, and diff counts so production evidence can stay
bucket/count-only. Use --show-items only for offline asset refresh review.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

B64_RE = re.compile(r'''(?P<quote>["'`])(?P<b64>[A-Za-z0-9+/]{80,}={0,2})(?P=quote)''')
SAFE_ITEM_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{0,120}[a-z0-9]$")
SENTINELS = {
    "domain_or_tld": ["cn", "sankuai.com", "zenmux.ai"],
    "keyword": ["deepseek", "volces"],
}


@dataclass(frozen=True)
class Extraction:
    kind: str
    xor_key: int
    items: tuple[str, ...]
    shape_detected: bool
    byte_offset: int

    @property
    def digest(self) -> str:
        payload = "\n".join(self.items).encode("utf-8")
        return hashlib.sha256(payload).hexdigest()


def decode_candidates(path: Path) -> list[Extraction]:
    data = path.read_bytes()
    text = data.decode("latin-1", errors="ignore")
    out: list[Extraction] = []
    seen: set[tuple[str, tuple[str, ...]]] = set()
    for match in B64_RE.finditer(text):
        b64 = match.group("b64")
        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception:
            continue
        if len(raw) < 32:
            continue
        for key in range(256):
            decoded = bytes(byte ^ key for byte in raw)
            if b"," not in decoded:
                continue
            try:
                decoded_text = decoded.decode("utf-8")
            except UnicodeDecodeError:
                continue
            items = tuple(item.strip().lower() for item in decoded_text.split(",") if item.strip())
            kind = classify_items(items)
            if not kind:
                continue
            marker = (kind, items)
            if marker in seen:
                continue
            seen.add(marker)
            window = text[max(0, match.start() - 5000): match.end() + 5000]
            shape_detected = "Buffer.from" in window and 'base64' in window and 'split(",")' in window
            out.append(Extraction(kind, key, items, shape_detected, match.start()))
    return sorted(out, key=lambda item: (item.kind, item.byte_offset))


def classify_items(items: tuple[str, ...]) -> str | None:
    if len(items) < 5:
        return None
    if any(not SAFE_ITEM_RE.match(item) for item in items):
        return None
    item_set = set(items)
    if {"cn", "sankuai.com", "zenmux.ai"}.issubset(item_set) and len(items) >= 100:
        return "domain_or_tld"
    if {"deepseek", "volces"}.issubset(item_set) and len(items) <= 50:
        return "keyword"
    return None


def summarize(path: Path, extractions: Iterable[Extraction], show_items: bool) -> dict[str, object]:
    groups: dict[str, list[dict[str, object]]] = {}
    for extraction in extractions:
        sentinel_list = SENTINELS.get(extraction.kind, [])
        entry: dict[str, object] = {
            "count": len(extraction.items),
            "xor_key": extraction.xor_key,
            "shape_detected": extraction.shape_detected,
            "byte_offset": extraction.byte_offset,
            "sha256": extraction.digest,
            "sentinels": {sentinel: sentinel in extraction.items for sentinel in sentinel_list},
        }
        if extraction.kind == "domain_or_tld":
            entry["specific_domain_count_excluding_cn"] = len([item for item in extraction.items if item != "cn"])
        if show_items:
            entry["items"] = extraction.items
        groups.setdefault(extraction.kind, []).append(entry)
    return {"path": str(path), "groups": groups}


def diff_against_baseline(baseline: list[Extraction], current: list[Extraction]) -> dict[str, object]:
    result: dict[str, object] = {}
    baseline_by_kind = {item.kind: item for item in baseline}
    current_by_kind = {item.kind: item for item in current}
    for kind in sorted(set(baseline_by_kind) | set(current_by_kind)):
        lhs = set(baseline_by_kind.get(kind, Extraction(kind, 0, tuple(), False, -1)).items)
        rhs = set(current_by_kind.get(kind, Extraction(kind, 0, tuple(), False, -1)).items)
        result[kind] = {
            "added_count": len(rhs - lhs),
            "removed_count": len(lhs - rhs),
            "changed": lhs != rhs,
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Claude Code env-residue taxonomy from local files")
    parser.add_argument("paths", nargs="+", type=Path, help="local cli.js or native binary path(s)")
    parser.add_argument("--show-items", action="store_true", help="print raw extracted items for offline asset refresh review")
    args = parser.parse_args()

    all_extractions: list[list[Extraction]] = []
    summaries = []
    for path in args.paths:
        if not path.exists() or not path.is_file():
            print(f"error: not a file: {path}", file=sys.stderr)
            return 2
        extracted = decode_candidates(path)
        all_extractions.append(extracted)
        summaries.append(summarize(path, extracted, args.show_items))

    output: dict[str, object] = {"files": summaries}
    if len(all_extractions) > 1:
        output["diff_vs_first"] = [diff_against_baseline(all_extractions[0], current) for current in all_extractions[1:]]

    print(json.dumps(output, ensure_ascii=True, indent=2, sort_keys=True))

    first = all_extractions[0] if all_extractions else []
    has_domain = any(item.kind == "domain_or_tld" and len(item.items) == 147 and "cn" in item.items for item in first)
    has_keyword = any(item.kind == "keyword" and len(item.items) == 11 and "deepseek" in item.items for item in first)
    return 0 if has_domain and has_keyword else 1


if __name__ == "__main__":
    raise SystemExit(main())
