#!/usr/bin/env python3
"""Count frontend lines of code across the ed-tools repositories.

For each repository listed below the script performs a shallow git clone
(cached locally on subsequent runs) and counts the lines of frontend source
code, broken down by file extension. This supports the migration project of
moving these apps from their current platform (Angular / Knockout) to React.

No third-party dependencies are required - only Python 3.8+ and git. History
mode additionally uses the GitHub CLI (`gh`, authenticated) to read merged PRs.

Usage:
    python3 count_frontend_loc.py                # count all repos at current HEAD
    python3 count_frontend_loc.py --refresh      # re-pull latest before counting
    python3 count_frontend_loc.py --workdir DIR  # where to cache the clones

    # History mode: sample migration progress at pull-request granularity. For
    # each merged PR on main that landed after the per-repo baseline commit, the
    # PR's final commit (GitHub's merge_commit_sha) is checked out and its lines
    # of code recorded, together with that commit hash and its timestamp. By
    # default only commits not already in the CSV are appended; pass --overwrite
    # to regenerate the whole history from scratch.
    python3 count_frontend_loc.py --history \\
        --baseline 'Grid=abc1234' --baseline 'Workflow=def5678'
"""

from __future__ import annotations

import argparse
import csv
import json
import re
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
    # Baseline commit for history mode: the first commit on main to report from.
    # Can also be supplied/overridden on the command line via --baseline.
    baseline: str | None = None
    # Angular/Knockout lines of code at the start of the migration. Migration
    # progress is measured as how much of this baseline has since been removed,
    # not from React added. Derived from the `baseline` commit (see REPOS).
    baseline_loc: int | None = None


REPOS: list[Repo] = [
    Repo("Workflow", "Angular", "https://github.com/guardian/workflow-frontend", baseline="5c1f3b0f09bd7f4813c82eabe988d931f7978aeb", baseline_loc=11717),
    Repo("Grid", "Angular", "https://github.com/guardian/grid", baseline="c455c353f08adbffafaa3427d0675615d7efacc7", baseline_loc=24896),
    Repo("Restorer", "Angular", "https://github.com/guardian/flexible-restorer", baseline="fa466dee9e8b59496ed0f4ce578d4d5becd69ba0", baseline_loc=3393),
    Repo("Fronts", "Knockout", "https://github.com/guardian/facia-tool", baseline="0b16232d7b317b83c7a3bfd5f4d4a1af58a35920", baseline_loc=12507),
    Repo("Story Packages", "Knockout", "https://github.com/guardian/story-packages", baseline="ac79901243069b52ce625d0231fe979b7dffdba4", baseline_loc=7594),
]

# Metric override: specific files to count as already migrated regardless of
# type (e.g. a stylesheet that has been ported), keyed by app -> repo-relative
# paths. This overrides classification only; the counting rules are unchanged.
MIGRATED_FILE_OVERRIDES: dict[str, set[str]] = {
    "Restorer": {"public/gu-noting.css"},
}

# --- What counts as "frontend" code -----------------------------------------

# Frontend code is grouped into categories. TypeScript / TSX is treated as
# code that has *already* been migrated to the target React/TS stack; the
# remaining categories represent code that still needs to be migrated.
# JavaScript / TypeScript files are only counted when their imports show they
# belong to a framework we track (see FRAMEWORK_PATTERNS), so unrelated tooling
# and config scripts are not mistaken for app code.
MIGRATED_CATEGORY = "Migrated (TS/TSX)"
# Cucumber/Gherkin feature files are tracked as a separate "added" metric,
# independent of the migration (neither to-migrate nor React migrated).
CUCUMBER_CATEGORY = "Cucumber features"

CATEGORIES: dict[str, set[str]] = {
    "JavaScript": {".js", ".jsx", ".mjs", ".cjs"},
    "HTML templates": {".html", ".htm"},
    "CSS": {".css", ".scss", ".sass", ".less"},
    MIGRATED_CATEGORY: {".ts", ".tsx", ".mts", ".cts"},
    CUCUMBER_CATEGORY: {".feature"},
}

# Categories whose lines still need to be migrated to React.
TO_MIGRATE_CATEGORIES: list[str] = [
    name for name in CATEGORIES if name not in (MIGRATED_CATEGORY, CUCUMBER_CATEGORY)
]

# Reverse lookup: file extension -> category name.
EXT_TO_CATEGORY: dict[str, str] = {
    ext: category for category, exts in CATEGORIES.items() for ext in exts
}

# File extensions we treat as frontend source code.
FRONTEND_EXTENSIONS: set[str] = set(EXT_TO_CATEGORY)

# JavaScript / TypeScript source whose relevance is confirmed by scanning the
# file's imports; HTML and CSS are always counted by extension.
CODE_EXTENSIONS: set[str] = CATEGORIES["JavaScript"] | CATEGORIES[MIGRATED_CATEGORY]

# Source platform (per repo) -> the framework its to-migrate code imports.
PLATFORM_FRAMEWORK: dict[str, str] = {
    "Angular": "angular",
    "Knockout": "knockout",
}

# A code file counts only if it imports one of these frameworks. React is always
# relevant (the migrated target); each repo also looks for its source platform.
# The quoted-module patterns match both `import ... from 'x'` and `require('x')`.
FRAMEWORK_PATTERNS: dict[str, list["re.Pattern[str]"]] = {
    "react": [
        re.compile(r"""['\"]react(?:-dom)?(?:/[\w.-]+)*['\"]"""),
        re.compile(r"""['\"]@emotion/(?:react|styled)['\"]"""),
    ],
    "angular": [
        re.compile(r"""['\"]@angular/[\w./-]+['\"]"""),
        re.compile(r"""['\"]angular(?:[-/][\w./-]*)?['\"]"""),
        re.compile(
            r"""\bangular\s*\.\s*"""
            r"""(?:module|component|controller|directive|service|factory|"""
            r"""filter|value|constant|provider|run|config)\s*\("""
        ),
    ],
    "knockout": [
        re.compile(r"""['\"]knockout['\"]"""),
        re.compile(
            r"""\bko\s*\.\s*"""
            r"""(?:observable|observableArray|computed|pureComputed|"""
            r"""applyBindings|bindingHandlers|components)\b"""
        ),
    ],
}


def relevant_frameworks(platform: str) -> set[str]:
    """Frameworks whose imports mark a code file as relevant for this repo."""
    frameworks = {"react"}
    source = PLATFORM_FRAMEWORK.get(platform)
    if source:
        frameworks.add(source)
    return frameworks


def detect_frameworks(text: str, candidates: set[str]) -> set[str]:
    """Return the subset of `candidates` whose import signatures appear in text."""
    found: set[str] = set()
    for framework in candidates:
        if any(pattern.search(text) for pattern in FRAMEWORK_PATTERNS[framework]):
            found.add(framework)
    return found

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


# Build / tooling config files (not application source) to exclude from counts.
BUILD_CONFIG_PATTERNS: tuple[re.Pattern, ...] = tuple(
    re.compile(p, re.IGNORECASE)
    for p in (
        r"\.config\.[mc]?[jt]s$",          # *.config.{js,ts,mjs,cjs,...}: webpack, vite, jest, rollup, babel, postcss, tailwind
        r"^webpack\.[\w.-]+\.[mc]?js$",     # webpack.dev.js, webpack.prod.js
        r"^rollup\.[\w.-]+\.[mc]?js$",
        r"^(?:gulpfile|gruntfile)\.[jt]s$",
        r"^karma\.conf\.[jt]s$",
        r"^\.(?:babelrc|eslintrc|prettierrc|stylelintrc)(?:\.[mc]?js)?$",
    )
)


def is_build_config(name: str) -> bool:
    return any(p.search(name) for p in BUILD_CONFIG_PATTERNS)


def is_frontend_file(path: Path) -> bool:
    if path.suffix.lower() not in FRONTEND_EXTENSIONS:
        return False
    # Skip minified / bundled files - they are generated, not source.
    name = path.name.lower()
    if ".min." in name or name.endswith("bundle.js"):
        return False
    # Skip build / tooling config - not application code.
    if is_build_config(name):
        return False
    # Skip Play/Scala server-side templates - not frontend framework code.
    if name.endswith(".scala.html"):
        return False
    return True


# --- Git helpers -------------------------------------------------------------

def clone_or_update(
    repo: Repo, workdir: Path, refresh: bool, full: bool = False
) -> Path:
    """Clone the repo into workdir, or update it if already present.

    `full=True` fetches the complete history, which history mode needs to walk
    commits; otherwise a shallow (depth 1) clone is used for a quick snapshot.
    """
    dest = workdir / repo.url.rstrip("/").split("/")[-1]
    if dest.exists():
        if refresh:
            print(f"  Updating {dest.name} ...")
            if full:
                _run(["git", "-C", str(dest), "fetch", "origin"])
            else:
                _run(["git", "-C", str(dest), "fetch", "--depth", "1", "origin"])
            _run(["git", "-C", str(dest), "reset", "--hard", "origin/HEAD"])
        else:
            print(f"  Using cached {dest.name}")
        if full and is_shallow(dest):
            print(f"  Fetching full history for {dest.name} ...")
            _run(["git", "-C", str(dest), "fetch", "--unshallow", "origin"])
        return dest

    print(f"  Cloning {repo.url} ...")
    if full:
        _run(["git", "clone", repo.url, str(dest)])
    else:
        _run(["git", "clone", "--depth", "1", repo.url, str(dest)])
    return dest


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\n{result.stderr.strip()}"
        )


def _capture(cmd: list[str]) -> str:
    """Run a command and return its stripped stdout, raising on failure."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"Command failed: {' '.join(cmd)}\n{result.stderr.strip()}"
        )
    return result.stdout.strip()


def is_shallow(repo_root: Path) -> bool:
    try:
        return _capture(
            ["git", "-C", str(repo_root), "rev-parse", "--is-shallow-repository"]
        ) == "true"
    except RuntimeError:
        return False


def default_branch_ref(repo_root: Path) -> str:
    """Return the remote-tracking ref for main, e.g. 'origin/main'."""
    try:
        return _capture(
            ["git", "-C", str(repo_root), "rev-parse", "--abbrev-ref", "origin/HEAD"]
        )
    except RuntimeError:
        # origin/HEAD may be unset on a fresh clone; try to populate it.
        try:
            _run(["git", "-C", str(repo_root), "remote", "set-head", "origin", "-a"])
            return _capture(
                ["git", "-C", str(repo_root), "rev-parse", "--abbrev-ref", "origin/HEAD"]
            )
        except RuntimeError:
            return "origin/HEAD"


def head_commit(repo_root: Path) -> str:
    return _capture(["git", "-C", str(repo_root), "rev-parse", "HEAD"])


def commit_timestamp(repo_root: Path, sha: str) -> str:
    """Return the committer date of `sha` in ISO 8601 format."""
    return _capture(["git", "-C", str(repo_root), "show", "-s", "--format=%cI", sha])


def repo_slug(repo: Repo) -> str:
    """Derive the GitHub 'owner/name' slug from the repo URL."""
    return "/".join(repo.url.rstrip("/").removesuffix(".git").split("/")[-2:])


def is_after_baseline(repo_root: Path, baseline: str, sha: str) -> bool:
    """True if `sha` is a strict descendant of `baseline` (landed after it)."""
    if sha == baseline:
        return False
    result = subprocess.run(
        ["git", "-C", str(repo_root), "merge-base", "--is-ancestor", baseline, sha],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def list_pr_commits(
    repo: Repo, repo_root: Path, baseline: str, limit: int
) -> list[tuple[str, int | None]]:
    """Merged PRs that landed on main after `baseline`, oldest first.

    Returns (merge_commit_sha, pr_number) pairs. PRs are squash/rebase merged, so
    each PR's merge_commit_sha is the single commit it produced on main - this
    samples history at pull-request granularity rather than per commit.
    """
    slug = repo_slug(repo)
    ref = default_branch_ref(repo_root)
    base = ref.split("/", 1)[1] if "/" in ref else ref
    out = _capture(
        [
            "gh", "pr", "list",
            "--repo", slug,
            "--state", "merged",
            "--base", base,
            "--json", "number,mergeCommit,mergedAt",
            "--limit", str(limit),
        ]
    )
    prs = json.loads(out) if out else []
    prs.sort(key=lambda pr: pr.get("mergedAt") or "")

    sampled: list[tuple[str, int | None]] = []
    for pr in prs:
        merge_commit = pr.get("mergeCommit") or {}
        sha = merge_commit.get("oid")
        if sha and is_after_baseline(repo_root, baseline, sha):
            sampled.append((sha, pr.get("number")))
    return sampled


def checkout_commit(repo_root: Path, sha: str) -> None:
    _run(["git", "-C", str(repo_root), "checkout", "--quiet", "--force", sha])


def restore_default_branch(repo_root: Path) -> None:
    """Return the working tree to the tip of main after walking history."""
    ref = default_branch_ref(repo_root)
    branch = ref.split("/", 1)[1] if "/" in ref else ref
    try:
        _run(["git", "-C", str(repo_root), "checkout", "--quiet", "--force", branch])
    except RuntimeError:
        pass


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

    @property
    def cucumber(self) -> int:
        return self.by_category.get(CUCUMBER_CATEGORY, 0)


def read_text(path: Path) -> str | None:
    """Read a file as UTF-8 text, returning None if it can't be read."""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None


# Gherkin scenario keywords (Scenario, Scenario Outline / Template).
SCENARIO_RE = re.compile(
    r"^\s*(?:Scenario Outline|Scenario Template|Scenario)\s*:", re.MULTILINE
)


def count_scenarios(text: str) -> int:
    return len(SCENARIO_RE.findall(text))


def analyse_repo(repo: Repo, repo_root: Path) -> RepoStats:
    stats = RepoStats(repo=repo)
    candidates = relevant_frameworks(repo.platform)
    overrides = MIGRATED_FILE_OVERRIDES.get(repo.app, set())
    for path in repo_root.rglob("*"):
        if not path.is_file():
            continue
        if is_excluded(path, repo_root):
            continue
        if not is_frontend_file(path):
            continue
        text = read_text(path)
        if text is None:
            continue
        ext = path.suffix.lower()
        rel = path.relative_to(repo_root).as_posix()
        overridden = rel in overrides
        # Code files count only when their imports show they use a framework we
        # track; HTML/CSS are always counted. Overridden files bypass this.
        if ext in CODE_EXTENSIONS and not overridden and not detect_frameworks(text, candidates):
            continue
        # Override: count listed files as already migrated regardless of type.
        category = MIGRATED_CATEGORY if overridden else EXT_TO_CATEGORY[ext]
        # Feature files are measured by scenario count, everything else by lines.
        count = count_scenarios(text) if category == CUCUMBER_CATEGORY else len(text.splitlines())
        stats.by_category[category] = stats.by_category.get(category, 0) + count
        stats.total_lines += count
        stats.total_files += 1
    return stats


# --- Reporting ---------------------------------------------------------------

def percent_complete(baseline: int | None, current: int) -> float | None:
    """Progress as Angular/Knockout lines removed vs the baseline, clamped 0-100."""
    if not baseline or baseline <= 0:
        return None
    return max(0.0, min(100.0, (baseline - current) / baseline * 100))


def _fmt_pct(pct: float | None) -> str:
    return f"{pct:.1f}%" if pct is not None else "-"


def category_status(category: str) -> str:
    if category == MIGRATED_CATEGORY:
        return "migrated"
    if category == CUCUMBER_CATEGORY:
        return "added"
    return "to_migrate"


def print_report(all_stats: list[RepoStats]) -> None:
    # --- Per-application summary (one row per app) ---------------------------
    print("\n" + "=" * 78)
    print("Summary by application")
    print("=" * 78)

    summary_header = (
        f"{'App':<16} {'Platform':<10} {'Files':>8} "
        f"{'Baseline':>12} {'To migrate':>12} {'Migrated':>12} "
        f"{'Scenarios':>10} {'Complete':>9}"
    )
    print(summary_header)
    print("-" * len(summary_header))

    grand_files = 0
    grand_baseline = 0
    grand_to_migrate = 0
    grand_migrated = 0
    grand_cucumber = 0
    for stats in all_stats:
        baseline = stats.repo.baseline_loc or 0
        pct = percent_complete(stats.repo.baseline_loc, stats.to_migrate)
        print(
            f"{stats.repo.app:<16} {stats.repo.platform:<10} "
            f"{stats.total_files:>8,} {baseline:>12,} {stats.to_migrate:>12,} "
            f"{stats.migrated:>12,} {stats.cucumber:>10,} {_fmt_pct(pct):>9}"
        )
        grand_files += stats.total_files
        grand_baseline += baseline
        grand_to_migrate += stats.to_migrate
        grand_migrated += stats.migrated
        grand_cucumber += stats.cucumber

    print("-" * len(summary_header))
    grand_pct = percent_complete(grand_baseline, grand_to_migrate)
    print(
        f"{'TOTAL':<16} {'':<10} {grand_files:>8,} "
        f"{grand_baseline:>12,} {grand_to_migrate:>12,} {grand_migrated:>12,} "
        f"{grand_cucumber:>10,} {_fmt_pct(grand_pct):>9}"
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


CSV_FIELDS = [
    "app", "platform", "category", "status", "lines",
    "commit", "timestamp", "baseline", "percent_complete",
]


def stats_to_rows(stats: RepoStats, commit: str, timestamp: str) -> list[dict]:
    """Turn a RepoStats into tidy (long) CSV rows, one per category.

    Each row carries the app's Angular/Knockout baseline and the resulting
    percent-complete (baseline removed vs baseline), so progress is measured by
    source code removed rather than React added.
    """
    baseline = stats.repo.baseline_loc
    pct = percent_complete(baseline, stats.to_migrate)
    rows: list[dict] = []
    for category in CATEGORIES:
        lines = stats.by_category.get(category, 0)
        status = category_status(category)
        rows.append(
            {
                "app": stats.repo.app,
                "platform": stats.repo.platform,
                "category": category,
                "status": status,
                "lines": lines,
                "commit": commit,
                "timestamp": timestamp,
                "baseline": baseline if baseline else "",
                "percent_complete": f"{pct:.1f}" if pct is not None else "",
            }
        )
    return rows


def existing_app_commits(csv_path: Path) -> set[tuple[str, str]]:
    """Return the (app, commit) pairs already recorded in the CSV."""
    seen: set[tuple[str, str]] = set()
    if not csv_path.exists():
        return seen
    with csv_path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            commit = row.get("commit")
            if commit:
                seen.add((row["app"], commit))
    return seen


def write_csv(rows: list[dict], csv_path: Path, append: bool = False) -> None:
    """Write tidy (long) rows to the CSV, overwriting or appending.

    When appending to an existing file the header is not repeated; otherwise the
    file is (re)created with a header row.
    """
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    appending = append and csv_path.exists()
    with csv_path.open("a" if appending else "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        if not appending:
            writer.writeheader()
        writer.writerows(rows)
    verb = "appended to" if appending else "written to"
    print(f"\n{len(rows)} rows {verb} {csv_path}")


def resolve_baselines(cli_baselines: list[str] | None) -> dict[str, str]:
    """Build an app -> baseline-commit map from REPOS plus CLI overrides."""
    baselines = {repo.app: repo.baseline for repo in REPOS if repo.baseline}
    for item in cli_baselines or []:
        if "=" not in item:
            raise SystemExit(
                f"--baseline must be in APP=SHA form, got: {item!r}"
            )
        app, sha = item.split("=", 1)
        baselines[app.strip()] = sha.strip()
    return baselines


def copy_to_web(csv_path: Path) -> None:
    """Keep the React app's copy in sync so `npm run dev` shows fresh data."""
    web_public = Path("web/public/report.csv")
    if web_public.parent.exists():
        shutil.copyfile(csv_path, web_public)
        print(f"CSV copied to {web_public}")


def run_snapshot(args: argparse.Namespace) -> int:
    all_stats: list[RepoStats] = []
    all_rows: list[dict] = []
    for repo in REPOS:
        print(f"\n{repo.app} ({repo.platform})")
        try:
            repo_root = clone_or_update(repo, args.workdir, args.refresh)
            commit = head_commit(repo_root)
            timestamp = commit_timestamp(repo_root, commit)
        except RuntimeError as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            continue
        stats = analyse_repo(repo, repo_root)
        all_stats.append(stats)
        all_rows.extend(stats_to_rows(stats, commit, timestamp))
        print(f"  {stats.total_files:,} files, {stats.total_lines:,} lines")

    if all_stats:
        print_report(all_stats)
        write_csv(all_rows, args.csv, append=False)
        copy_to_web(args.csv)
    return 0


def run_history(args: argparse.Namespace) -> int:
    baselines = resolve_baselines(args.baseline)
    append = not args.overwrite
    seen = existing_app_commits(args.csv) if append else set()

    new_rows: list[dict] = []
    for repo in REPOS:
        baseline = baselines.get(repo.app)
        if not baseline:
            print(f"\n{repo.app}: no baseline commit configured, skipping")
            continue

        print(f"\n{repo.app} ({repo.platform})")
        try:
            repo_root = clone_or_update(repo, args.workdir, args.refresh, full=True)
            baseline_sha = _capture(
                ["git", "-C", str(repo_root), "rev-parse", baseline]
            )
            samples = [(baseline_sha, None), *list_pr_commits(
                repo, repo_root, baseline_sha, args.pr_limit
            )]
        except RuntimeError as exc:
            print(f"  ERROR: {exc}", file=sys.stderr)
            continue

        print(f"  {len(samples)} sample(s): baseline + merged PRs since it")
        recorded = 0
        try:
            for sha, pr in samples:
                if append and (repo.app, sha) in seen:
                    continue
                try:
                    checkout_commit(repo_root, sha)
                    timestamp = commit_timestamp(repo_root, sha)
                except RuntimeError as exc:
                    print(f"  ERROR at {sha[:10]}: {exc}", file=sys.stderr)
                    continue
                stats = analyse_repo(repo, repo_root)
                new_rows.extend(stats_to_rows(stats, sha, timestamp))
                recorded += 1
                label = f"PR #{pr}" if pr else "baseline"
                print(
                    f"  {sha[:10]}  {timestamp}  {label:>10}  "
                    f"{stats.total_lines:,} lines ({stats.total_files:,} files)"
                )
        finally:
            restore_default_branch(repo_root)
        print(f"  recorded {recorded} new sample(s)")

    if new_rows:
        write_csv(new_rows, args.csv, append=append)
        print(
            "History mode records one row per PR; the React dashboard "
            "expects a single snapshot, so web/public/report.csv was not updated."
        )
    else:
        print("\nNo new PRs to record.")
    return 0


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
    parser.add_argument(
        "--history",
        action="store_true",
        help=(
            "Sample migration progress per merged PR on main (via the gh CLI): "
            "for each PR landed after the per-repo baseline commit, record LOC "
            "at the PR's final commit"
        ),
    )
    parser.add_argument(
        "--baseline",
        action="append",
        metavar="APP=SHA",
        help=(
            "Baseline commit for a repo in history mode, e.g. "
            "--baseline 'Grid=abc1234'. Repeatable; overrides REPOS baselines"
        ),
    )
    parser.add_argument(
        "--pr-limit",
        type=int,
        default=1000,
        help=(
            "Max merged PRs to fetch per repo in history mode, newest first "
            "(default: 1000)"
        ),
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help=(
            "In history mode, rewrite the CSV from scratch instead of only "
            "appending commits not already recorded (the default)"
        ),
    )
    args = parser.parse_args(argv)

    args.workdir.mkdir(parents=True, exist_ok=True)

    if args.history:
        return run_history(args)
    return run_snapshot(args)


if __name__ == "__main__":
    raise SystemExit(main())
