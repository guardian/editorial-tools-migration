# Ed tools modernisation stats

This contains stats for the ed tools modernisation project
We are look at the number of lines of code that we need to migrate across 6 applications

Those applications and their repos are:

| App            | Platform | Repository                                    |
| -------------- | -------- | --------------------------------------------- |
| Workflow       | Angular  | https://github.com/guardian/workflow-frontend |
| Grid           | Angular  | https://github.com/guardian/grid              |
| Restorer       | Angular  | https://github.com/guardian/flexible-restorer |
| Fronts         | Knockout | https://github.com/guardian/facia-tool        |
| Story Packages | Knockout | https://github.com/guardian/story-packages    |

## Generating the report

```sh
python3 count_frontend_loc.py            # snapshot of current HEAD for every repo
python3 count_frontend_loc.py --refresh  # re-pull latest before counting
```

The CSV (`report.csv`) has one row per app + category with these columns:

`app, platform, category, status, lines, commit, timestamp, baseline, percent_complete`

`commit` and `timestamp` record the git commit the numbers were measured at and
its committer date (ISO 8601), so changes can be tracked over time.

### Measuring progress

Progress is measured by how much of the original Angular/Knockout code has been
**removed**, not by how much React has been added (React is kept in the report
for analysis, but excluded from the percentage):

```
percent_complete = clamp((baseline - current_to_migrate) / baseline, 0, 100)
```

`baseline` is the Angular/Knockout lines of code at the start of the migration,
set per app via `baseline` (a commit SHA) and `baseline_loc` on each entry in
`REPOS`. The baselines currently in `REPOS` were derived from a pull request on
each repo merged around five months before this was recorded; `baseline_loc` is
the Angular/Knockout line count measured at that commit. The `baseline` and
`percent_complete` columns are written to the CSV (and shown in the console
report and the dashboard) for every measured commit, so the percentage reflects
source code retired over time.

### What counts as framework code

JavaScript/TypeScript files are only counted when their imports show they belong
to a framework we track, so build scripts, config, and other unrelated `.js`/
`.ts` files are excluded. Each repo looks for React (the migrated target) plus
its source platform:

- **React** (migrated): imports/requires of `react`, `react-dom`, or
  `@emotion/react`/`@emotion/styled`. An explicit React import is required even
  for `.jsx`/`.tsx`.
- **Angular**: `@angular/*` or `angular` imports, or `angular.module(` /
  `.component(` / `.controller(` / `.directive(` (and similar) usage.
- **Knockout**: `knockout` imports or `ko.observable`/`ko.applyBindings` usage.

HTML templates and CSS are always counted by extension.

### History mode

To track progress over time, history mode samples migration progress **per
merged pull request**. Because PRs are squash/rebase merged (no merge commits),
it reads merged PRs from GitHub and takes each PR's final commit on `main`
(GitHub's `merge_commit_sha`), rather than walking every commit, which keeps the
report clean. For each PR landed after a per-repo **baseline commit** it checks
out that commit and records one set of rows:

```sh
python3 count_frontend_loc.py --history \
    --baseline 'Grid=abc1234' \
    --baseline 'Workflow=def5678'
```

- Requires the GitHub CLI (`gh`) to be installed and authenticated.
- Baselines can be supplied with `--baseline 'App=SHA'` (repeatable) or set on
  each entry in `REPOS`. Repos without a baseline are skipped. Only PRs whose
  final commit is a descendant of the baseline (i.e. landed after it) are
  sampled; the baseline commit itself is recorded as the first data point.
- `--pr-limit N` caps how many merged PRs are fetched per repo (newest first,
  default 1000).
- By default only commits not already present in the CSV are appended, so reruns
  are incremental. Pass `--overwrite` to regenerate the whole history.
- History mode does not update the React dashboard's copy, which expects a
  single snapshot.

