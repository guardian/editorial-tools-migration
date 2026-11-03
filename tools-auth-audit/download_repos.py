#!/usr/bin/env python3
"""Download the editorial tool repositories listed in the master CSV.

Reads ``data/master.csv`` (produced by ``generate_master_csv.py``) and performs
a shallow git clone of each unique GitHub repository into a local cache
directory. The cache is transient and git-ignored; re-running reuses existing
clones unless ``--refresh`` is passed.

Several tools share a repo (e.g. the Fronts apps all map to ``facia-tool``), so
repositories are de-duplicated before cloning.

Usage:
    python3 download_repos.py                 # clone all repos (cached)
    python3 download_repos.py --refresh       # update already-cloned repos
    python3 download_repos.py --workdir DIR   # where to cache the clones
"""

from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from pathlib import Path

DEFAULT_CSV = Path(__file__).parent / "data" / "master.csv"
DEFAULT_WORKDIR = Path(__file__).parent / ".repos"


def read_github_links(csv_path: Path) -> list[str]:
    """Return the unique, non-empty github links from the master CSV, in order."""
    if not csv_path.exists():
        sys.exit(
            f"error: {csv_path} not found. Run generate_master_csv.py first."
        )
    seen: set[str] = set()
    links: list[str] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            link = (row.get("github_link") or "").strip().rstrip("/")
            if link and link not in seen:
                seen.add(link)
                links.append(link)
    return links


def clone_or_update(url: str, workdir: Path, refresh: bool) -> bool:
    """Shallow-clone url into workdir, or update it if already present.

    Returns True on success, False if the git operation failed.
    """
    dest = workdir / url.rstrip("/").split("/")[-1]
    if dest.exists():
        if refresh:
            print(f"  Updating {dest.name} ...")
            ok = _run(["git", "-C", str(dest), "fetch", "--depth", "1", "origin"])
            if ok:
                ok = _run(["git", "-C", str(dest), "reset", "--hard", "origin/HEAD"])
            return ok
        print(f"  Using cached {dest.name}")
        return True

    print(f"  Cloning {url} ...")
    return _run(["git", "clone", "--depth", "1", url, str(dest)])


def _run(cmd: list[str]) -> bool:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"    failed: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--csv", type=Path, default=DEFAULT_CSV, help="Master CSV to read."
    )
    parser.add_argument(
        "--workdir",
        type=Path,
        default=DEFAULT_WORKDIR,
        help="Directory used to cache the cloned repositories (default: .repos).",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Fetch the latest changes for already-cloned repositories.",
    )
    args = parser.parse_args()

    links = read_github_links(args.csv)
    if not links:
        sys.exit("error: no github links found in CSV.")

    args.workdir.mkdir(parents=True, exist_ok=True)

    failures: list[str] = []
    print(f"Downloading {len(links)} repositories into {args.workdir} ...")
    for url in links:
        if not clone_or_update(url, args.workdir, args.refresh):
            failures.append(url)

    succeeded = len(links) - len(failures)
    print(f"\nDone: {succeeded}/{len(links)} repositories available.")
    if failures:
        print("Failed:", file=sys.stderr)
        for url in failures:
            print(f"  {url}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
