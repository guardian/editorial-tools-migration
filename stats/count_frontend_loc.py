#!/usr/bin/env python3
"""Count frontend lines of code across the ed-tools repositories.

For each repository listed below the script performs a shallow git clone
(cached locally on subsequent runs) and counts the lines of frontend source
code, broken down by file extension. This supports the migration project of
moving these apps from their current platform (Angular / Knockout) to React.

No third-party dependencies are required - only Python 3.8+ and git.

Usage:
    python3 count_frontend_loc.py                # count all repos
    python3 count_frontend_loc.py --refresh      # re-pull latest before counting
    python3 count_frontend_loc.py --workdir DIR  # where to cache the clones
"""

from __future__ import annotations

import argparse
import csv
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --- Repositories to analyse -------------------------------------------------

@dataclass(frozen=True)
class Repo:
    app: str
    platform: str
    url: str


REPOS: list[Repo] = [
    Repo("Workflow", "Angular", "https://github.com/guardian/workflow-frontend"),
    Repo("Grid", "Angular", "https://github.com/guardian/grid"),
    Repo("Restorer", "Angular", "https://github.com/guardian/flexible-restorer"),
    Repo("Fronts", "Knockout", "https://github.com/guardian/facia-tool"),
    Repo("Story Packages", "Knockout", "https://github.com/guardian/story-packages"),
]

# --- What counts as "frontend" code -----------------------------------------

# Frontend code is grouped into categories. TypeScript / TSX is treated as
# code that has *already* been migrated to the target React/TS stack; the
# remaining categories represent code that still needs to be migrated.
MIGRATED_CATEGORY = "Migrated (TS/TSX)"

CATEGORIES: dict[str, set[str]] = {
    "JavaScript": {".js", ".jsx", ".mjs", ".cjs"},
    "HTML templates": {".html", ".htm"},
    "CSS": {".css", ".scss", ".sass", ".less"},
    MIGRATED_CATEGORY: {".ts", ".tsx", ".mts", ".cts"},
}

# Categories whose lines still need to be migrated to React.
TO_MIGRATE_CATEGORIES: list[str] = [
    name for name in CATEGORIES if name != MIGRATED_CATEGORY
]

# Reverse lookup: file extension -> category name.
EXT_TO_CATEGORY: dict[str, str] = {
    ext: category for category, exts in CATEGORIES.items() for ext in exts
}

# File extensions we treat as frontend source code.
FRONTEND_EXTENSIONS: set[str] = set(EXT_TO_CATEGORY)

# Directory names anywhere in the path that should be skipped. These are
# dependency, build output, and vendored folders that are not code we would
# hand-migrate to React.
EXCLUDED_DIRS: set[str] = {
    ".git",
    "node_modules",
    "bower_components",
    "vendor",
    "vendors",
    "dist",
    "build",
    "target",
    "out",
    "coverage",
    ".idea",
    ".vscode",
    "__pycache__",
}


def is_excluded(path: Path, repo_root: Path) -> bool:
    """Return True if any part of the relative path is an excluded directory."""
    rel_parts = path.relative_to(repo_root).parts
    return any(part in EXCLUDED_DIRS for part in rel_parts)


def is_frontend_file(path: Path) -> bool:
    if path.suffix.lower() not in FRONTEND_EXTENSIONS:
        return False
    # Skip minified / bundled files - they are generated, not source.
    name = path.name.lower()
    if ".min." in name or name.endswith("bundle.js"):
        return False
    return True


# --- Git helpers -------------------------------------------------------------

def clone_or_update(repo: Repo, workdir: Path, refresh: bool) -> Path:
    """Shallow-clone the repo into workdir, or update it if already present."""
    dest = workdir / repo.url.rstrip("/").split("/")[-1]
    if dest.exists():
        if refresh:
            print(f"  Updating {dest.name} ...")
            _run(["git", "-C", str(dest), "fetch", "--depth", "1", "origin"])
            _run(["git", "-C", str(dest), "reset", "--hard", "origin/HEAD"])
        else:
            print(f"  Using cached {dest.name}")
        return dest

    print(f"  Cloning {repo.url} ...")
    _run(["git", "clone", "--depth", "1", repo.url, str(dest)])
    return dest


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\n{result.stderr.strip()}"
        )


# --- Counting ----------------------------------------------------------------

@dataclass
class RepoStats:
    repo: Repo
    total_lines: int = 0
    total_files: int = 0
    by_category: dict[str, int] = field(default_factory=dict)

    @property
    def to_migrate(self) -> int:
        return sum(
            self.by_category.get(name, 0) for name in TO_MIGRATE_CATEGORIES
        )

    @property
    def migrated(self) -> int:
        return self.by_category.get(MIGRATED_CATEGORY, 0)


def count_lines(path: Path) -> int:
    """Count lines in a file, tolerating binary / undecodable content."""
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            return sum(1 for _ in fh)
    except OSError:
        return 0


def analyse_repo(repo: Repo, repo_root: Path) -> RepoStats:
    stats = RepoStats(repo=repo)
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        if is_excluded(path, repo_root):
            continue
        if not is_frontend_file(path):
            continue
        lines = count_lines(path)
        category = EXT_TO_CATEGORY[path.suffix.lower()]
        stats.by_category[category] = stats.by_category.get(category, 0) + lines
        stats.total_lines += lines
        stats.total_files += 1
    return stats


# --- Reporting ---------------------------------------------------------------

def print_report(all_stats: list[RepoStats]) -> None:
    # --- Per-application summary (one row per app) ---------------------------
    print("\n" + "=" * 78)
    print("Summary by application")
    print("=" * 78)

    summary_header = (
        f"{'App':<16} {'Platform':<10} {'Files':>8} "
        f"{'To migrate':>12} {'Migrated':>12}"
    )
    print(summary_header)
    print("-" * len(summary_header))

    grand_files = 0
    grand_to_migrate = 0
    grand_migrated = 0
    for stats in all_stats:
        print(
            f"{stats.repo.app:<16} {stats.repo.platform:<10} "
            f"{stats.total_files:>8,} {stats.to_migrate:>12,} "
            f"{stats.migrated:>12,}"
        )
        grand_files += stats.total_files
        grand_to_migrate += stats.to_migrate
        grand_migrated += stats.migrated

    print("-" * len(summary_header))
    print(
        f"{'TOTAL':<16} {'':<10} {grand_files:>8,} "
        f"{grand_to_migrate:>12,} {grand_migrated:>12,}"
    )

    # --- Detailed per-application category breakdown ------------------------
    print("\n" + "=" * 78)
    print("Frontend lines of code by repository")
    print("=" * 78)

    header = (
        f"{'App':<16} {'Platform':<10} {'Category':<18} "
        f"{'To migrate':>12} {'Migrated':>12}"
    )
    print(header)
    print("-" * len(header))

    for stats in all_stats:
        # One row per to-migrate category, then a migrated row for the repo.
        first = True
        for category in TO_MIGRATE_CATEGORIES:
            lines = stats.by_category.get(category, 0)
            app = stats.repo.app if first else ""
            platform = stats.repo.platform if first else ""
            first = False
            print(
                f"{app:<16} {platform:<10} {category:<18} "
                f"{lines:>12,} {'':>12}"
            )
        # Repo subtotal row including the migrated column.
        print(
            f"{'':<16} {'':<10} {'-> subtotal':<18} "
            f"{stats.to_migrate:>12,} {stats.migrated:>12,}"
        )
        print("-" * len(header))

    # Grand totals per category across all repos.
    print("\nTotals across all repositories:")
    totals_header = f"{'Category':<18} {'To migrate':>12} {'Migrated':>12}"
    print(totals_header)
    print("-" * len(totals_header))

    grand_to_migrate = 0
    for category in TO_MIGRATE_CATEGORIES:
        lines = sum(s.by_category.get(category, 0) for s in all_stats)
        grand_to_migrate += lines
        print(f"{category:<18} {lines:>12,} {'':>12}")

    grand_migrated = sum(s.migrated for s in all_stats)
    print("-" * len(totals_header))
    print(f"{'TOTAL':<18} {grand_to_migrate:>12,} {grand_migrated:>12,}")


def write_csv(all_stats: list[RepoStats], csv_path: Path) -> None:
    """Write the report in tidy (long) format: one row per app + category."""
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["app", "platform", "category", "status", "lines"])
        for stats in all_stats:
            for category in CATEGORIES:
                lines = stats.by_category.get(category, 0)
                status = (
                    "migrated"
                    if category == MIGRATED_CATEGORY
                    else "to_migrate"
                )
                writer.writerow(
                    [stats.repo.app, stats.repo.platform, category, status, lines]
                )
    print(f"\nCSV written to {csv_path}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workdir",
        type=Path,
        default=Path(".repos"),
        help="Directory used to cache the cloned repositories (default: .repos)",
    )
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Fetch the latest changes for already-cloned repositories",
    )
    parser.add_argument(
        "--csv",
        type=Path,
        default=Path("report.csv"),
        help="Path to write the CSV report (default: report.csv)",
    )
    args = parser.parse_args(argv)

    args.workdir.mkdir(parents=True, exist_ok=True)

    all_stats: list[RepoStats] = []
    for repo in REPOS:
        print(f"\n{repo.app} ({repo.platform})")
        try:
            repo_root = clone_or_update(repo, args.workdir, args.refresh)
        except RuntimeError as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            continue
        stats = analyse_repo(repo, repo_root)
        all_stats.append(stats)
        print(f"  {stats.total_files:,} files, {stats.total_lines:,} lines")

    if all_stats:
        print_report(all_stats)
        write_csv(all_stats, args.csv)
        # Keep the React app's copy in sync so `npm run dev` shows fresh data.
        web_public = Path("web/public/report.csv")
        if web_public.parent.exists():
            shutil.copyfile(args.csv, web_public)
            print(f"CSV copied to {web_public}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
