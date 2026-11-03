#!/usr/bin/env python3
"""Generate the master CSV of editorial tools.

Source of truth is the Guardian ``tools-index`` repo:
https://github.com/guardian/tools-index/blob/main/src/config/editorial-tools.ts

Each tool is parsed into three fields: app name, GitHub link and primary link.
The ``tools-index`` repo is private, so by default the config is fetched with the
authenticated ``gh`` CLI. A local copy can be used instead via ``--source-file``.
"""

from __future__ import annotations

import argparse
import base64
import csv
import re
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_REPO = "guardian/tools-index"
DEFAULT_PATH = "src/config/editorial-tools.ts"
DEFAULT_REF = "main"
DEFAULT_OUTPUT = Path(__file__).parent / "data" / "master.csv"

# Matches each `const Name: App = { ... }` definition up to the next one.
APP_BLOCK_RE = re.compile(
    r"const\s+\w+\s*:\s*App\s*=\s*\{(.*?)\n\}", re.DOTALL
)
NAME_RE = re.compile(r"name:\s*(['\"`])(.*?)\1", re.DOTALL)
# githubLink('repo') or githubLink('repo', 'org')
GITHUB_RE = re.compile(
    r"githubLink\(\s*['\"`]([^'\"`]+)['\"`]\s*(?:,\s*['\"`]([^'\"`]+)['\"`]\s*)?\)"
)


def fetch_from_gh(repo: str, path: str, ref: str, attempts: int = 4) -> str:
    """Fetch file content from GitHub using the authenticated gh CLI.

    The contents API occasionally returns transient 5xx errors, so retry a few
    times with a short backoff before giving up.
    """
    last_error = ""
    for attempt in range(1, attempts + 1):
        try:
            result = subprocess.run(
                [
                    "gh",
                    "api",
                    f"repos/{repo}/contents/{path}?ref={ref}",
                    "--jq",
                    ".content",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
        except FileNotFoundError:
            sys.exit("error: 'gh' CLI not found. Install it or pass --source-file.")
        except subprocess.CalledProcessError as exc:
            last_error = exc.stderr.strip()
            if attempt < attempts:
                time.sleep(2 * attempt)
                continue
            sys.exit(f"error: gh api failed after {attempts} attempts: {last_error}")
        else:
            return base64.b64decode(result.stdout).decode("utf-8")
    sys.exit(f"error: gh api failed: {last_error}")


def extract_primary_link(block: str) -> str:
    """Return the primary link URL for an app block.

    Handles both ``primaryLink: prodLink('url')`` and the object form
    ``primaryLink: { ..., url: new URL('url') }``.
    """
    idx = block.find("primaryLink:")
    if idx == -1:
        return ""
    tail = block[idx:]
    prod = re.search(r"prodLink\(\s*['\"`]([^'\"`]+)['\"`]", tail)
    if prod:
        return prod.group(1)
    url = re.search(r"new URL\(\s*['\"`]([^'\"`]+)['\"`]", tail)
    if url:
        return url.group(1)
    return ""


def parse_tools(source: str) -> list[dict[str, str]]:
    tools: list[dict[str, str]] = []
    for block in APP_BLOCK_RE.findall(source):
        name_match = NAME_RE.search(block)
        if not name_match:
            continue
        name = name_match.group(2)

        github_link = ""
        gh_match = GITHUB_RE.search(block)
        if gh_match:
            repo = gh_match.group(1)
            org = gh_match.group(2) or "guardian"
            github_link = f"https://github.com/{org}/{repo}"

        primary_link = extract_primary_link(block)

        tools.append(
            {
                "app_name": name,
                "github_link": github_link,
                "primary_link": primary_link,
            }
        )
    return tools


def write_csv(tools: list[dict[str, str]], output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle, fieldnames=["app_name", "github_link", "primary_link"]
        )
        writer.writeheader()
        writer.writerows(tools)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-file",
        type=Path,
        help="Read editorial-tools.ts from a local file instead of fetching via gh.",
    )
    parser.add_argument("--repo", default=DEFAULT_REPO, help="GitHub repo to fetch from.")
    parser.add_argument("--path", default=DEFAULT_PATH, help="Path to the config file.")
    parser.add_argument("--ref", default=DEFAULT_REF, help="Git ref to fetch.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Where to write the master CSV.",
    )
    args = parser.parse_args()

    if args.source_file:
        source = args.source_file.read_text(encoding="utf-8")
    else:
        source = fetch_from_gh(args.repo, args.path, args.ref)

    tools = parse_tools(source)
    if not tools:
        sys.exit("error: no tools parsed from source.")

    write_csv(tools, args.output)
    print(f"Wrote {len(tools)} tools to {args.output}")


if __name__ == "__main__":
    main()
