# tools-auth-audit

Audit the authentication posture of the Guardian's editorial tools.

The goal is to list every editorial tool application, inspect the endpoints each
app exposes (via its Scala Play `routes` file), and record whether each endpoint
requires authentication and, if so, which authentication type.

## Step 1 — master tool list (done)

The list of tools and their repositories comes from the `tools-index` config:
<https://github.com/guardian/tools-index/blob/main/src/config/editorial-tools.ts>

`generate_master_csv.py` parses that file and produces a master CSV with three
columns: `app_name`, `github_link`, `primary_link`.

### Usage

The `tools-index` repo is private, so by default the config is fetched with the
authenticated GitHub CLI (`gh auth login` first):

```bash
python3 generate_master_csv.py
```

Output is written to `data/master.csv`.

Options:

- `--source-file PATH` — parse a local copy of `editorial-tools.ts` instead of
  fetching it.
- `--output PATH` — change the output location.
- `--repo`, `--path`, `--ref` — override the GitHub source location.

## Next steps (planned)

- Clone/download each repo from `master.csv`.
- Locate and parse the Play `conf/routes` file(s).
- For each endpoint, determine whether authentication is required and its type.
- Emit an audit CSV/report.
