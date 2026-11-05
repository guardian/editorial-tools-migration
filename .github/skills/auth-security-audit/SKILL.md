---
name: auth-security-audit
description: 'Per-repo security audit of an editorial tool: verify every route in its routes file against the actual source, identify vulnerabilities (SSRF, open redirect, CSRF, missing per-resource authz/IDOR, XSS, injection, info disclosure), confirm infra/compensating controls (ALB/WAF/CloudFront/cookies), score each finding (OWASP + CWE), and emit a detail CSV + a summary CSV. USE WHEN: asked to "double check security findings", "audit <repo> for vulnerabilities", "check the routes for auth/CSRF/SSRF", "write a security report for <repo>", or to extend the facia-tool security review to another repo in tools-auth-audit. Works one repo at a time.'
---

# Editorial Tools — Per-Repo Auth & Security Audit

Repeatable workflow for security-reviewing one editorial tool at a time. It extends the
`tools-auth-audit` auth inventory with a verified, source-backed vulnerability assessment.
This is the method used to produce `reports/security/facia-tool-security.csv` and
`reports/security/facia-tool-security-summary.csv` — use that pair as the reference example.

## Inputs (gather first)

Ask for / confirm the **repo name** (e.g. `grid`, `workflow`, `media-atom-maker`). Then locate:

1. **Cloned source** — check in order, use the first that exists:
   - `tools-auth-audit/.repos/<repo>/`
   If neither exists, clone it with `cd tools-auth-audit && python3 download_repos.py` (reads `data/master.csv`).
2. **Existing auth inventory** — `tools-auth-audit/reports/<repo>.csv` (one row per route with the
   already-resolved `auth_method`). This is your route list and starting point; do **not** trust it
   blindly — the whole point is to verify it against source.
3. **Non-Play repos** — if there is no `conf/routes`, the app is Node/Express/Lambda/Scalatra; its
   endpoints are curated in `tools-auth-audit/manual/<repo>.csv`. Audit routes from the router/handler
   code (Express routers, serverless handlers, API Gateway definitions) using the same checks below.

## Workflow

Track progress with a todo list. Do the repo one pass at a time; never fabricate evidence — every
claim must cite a file + line you have actually read.

### 1. Map the attack surface
- Read `conf/routes` (and any `->` includes) — enumerate every `METHOD path controller.action`.
- Find the **HTTP filters** (usually `app/Components.scala`, `app/Loader.scala`, or `app/**/Filters.scala`).
  Record whether these are present or **absent**: `CSRFFilter`, `AllowedHostsFilter`,
  `SecurityHeadersFilter` (X-Frame-Options / CSP frame-ancestors), and the CORS filter + its
  `allowedOrigins` (often `Origins.Matching(Set(applicationUrl))`).
- Note the auth action builders in use (`AccessAuthAction`, `AccessAPIAuthAction`, `APIAuthAction`,
  HMAC actions, custom) and the permission checks they chain (e.g. `withModifyPermissionForCollections`,
  `ConfigPermissionCheck`, `EditEditionsAuthAction`).

### 2. Verify each route against source (don't trust the route name)
For every route, open the controller action and confirm:
- **Auth** — the wrapper actually applied, and any **per-resource** permission check. Compare sibling
  actions for inconsistency (the facia-tool `publishCollection` has `withModifyPermissionForCollections`
  but `discardCollection` does **not** → IDOR/missing authz).
- **Dangerous sinks** — grep the app for the patterns below, then read each hit:

  ```
  Html\(|\.raw\(|preEscapedText|wsClient\.url|\.url\(|Redirect\(|\.exec\(|queryString|sendFile|fromFile
  ```

  | Sink | Vulnerability to check |
  |------|------------------------|
  | `wsClient.url(<user input>)` | SSRF / open proxy (CWE-918). Is the host user-controlled or a fixed config host? Are credentials/signed headers forwarded? |
  | `Redirect("/" + input)` / redirect to user input | Open redirect (CWE-601); protocol-relative `//evil.com` |
  | `@Html(...)`, `.raw(...)`, `preEscapedText` in Twirl | Stored/reflected XSS (CWE-79). Is the value user-controlled? Twirl auto-escapes `@x` but **not** `@Html(x)` |
  | reflected `queryString`/path param into a view | Reflected XSS / injection |
  | `postMessage(data, '*')` | Sensitive data disclosure via wildcard target origin (CWE-346) |
  | raw string-interpolated SQL (`s"...$x..."`) | SQL injection (CWE-89). `sql"..."` (scalikejdbc) / anorm `{}` are parameterized = safe |
  | DynamoDB / datastore keys | confirm parameterized, not string-built |
  | file path from input | path traversal (CWE-22) |
- **Self-scoped writes** — writes keyed to `request.user.email` (not an attacker-supplied id) are not IDOR.
- **Verify templates** — if a param reaches a view, open the `.scala.html` and confirm escaping.

### 3. Confirm infra / compensating controls (so scores are accurate)
Read `cdk/lib/*.ts` (or `*.template.yaml` / CloudFormation), `riff-raff.yaml`, and `nginx/*`. Grep:

```
AccessScope|WebAcl|[Ww][Aa][Ff]|RESTRICTED|authenticate|oidc|OIDC|cidrBlock|CidrIp|ipAllow
```

Determine and record:
- **ALB exposure** — `AccessScope.PUBLIC` (internet-facing, `0.0.0.0/0`) vs `RESTRICTED` (IP allowlist).
- **Edge auth** — any ALB `authenticate-oidc` / Google IAP / Lambda@Edge auth? (usually none; auth is app-level pan-domain).
- **WAF** — any `webAclId` on CloudFront/ALB? (often none — state it explicitly).
- **CloudFront** — caching vs pass-through, and which headers it forwards.
- **Cookies** — `conf/application.conf` `play.http.session` `secure` / `sameSite`; note the pan-domain
  cookie's SameSite is library-controlled (verify if it matters for a CSRF claim).

### 4. Reason about CSRF / SSRF reachability precisely
- Play's **CORS filter returns 403** for cross-origin requests that carry an `Origin` header
  (fetch/XHR) → blocks scripted CSRF of mutations.
- Browsers **omit `Origin`** on top-level GET navigations and `<img>`/`<script>` subresource loads →
  these bypass the CORS filter. `SameSite=Lax` still sends the cookie on **top-level GET navigation**.
- A state-changing **GET** with no CSRF token (e.g. `logout`) is a CSRF vector via no-Origin navigation.
- For **SSRF with credential forwarding**, enumerate the exact material sent and whether it is
  **replayable** (e.g. AWS SigV4 sends access key ID + `X-Amz-Security-Token` + signature but **never**
  the secret key, and the signature is bound to the signed URL → not replayable). Rate on real impact.

### 5. Score each finding
Classify with **OWASP category + CWE**, a label + numeric score, cited evidence, and a one-line reason.

| Band | When |
|------|------|
| **Info (1.0)** | No issue: auth enforced + verified; read-only; parameterized; fixed-host proxy; self-scoped write; output auto-escaped. Say *why*. |
| **Low (2.0–4.5)** | Authenticated nuisance (forced logout); missing per-resource authz with limited impact; unauth open redirect; reflected-but-escaped; missing CSRF token but mitigated by CORS + JSON body; identity/info disclosure. |
| **Medium (5.0–6.9)** | Full-read SSRF / credential or token disclosure, gated behind an authenticated session. |
| **High (7.0+)** | Unauthenticated RCE, data exfiltration, or privilege escalation. |

Adjust for compensating controls found in step 3 (e.g. no WAF = no mitigation; CORS/JSON body = partial).

### 6. Emit the two CSVs
Write into `tools-auth-audit/reports/security/`:

**`<repo>-security.csv`** — one row per route. Header (16 cols), exactly:
```
repo,technology,language,version,runs_in_project,module,http_method,route_path,controller_action,action_builder,auth_method,auth_evidence,notes,vulnerability,risk_score,score_reason
```
- `vulnerability`: "None identified: <why>" or "<Name> (OWASP Axx, CWE-nnn): <mechanism + evidence>".
- `auth_evidence`: `app/controllers/<File>.scala: <builder>`.
- `risk_score`: `Info (1.0)` / `Low (x.x)` / `Medium (x.x)` / `High (x.x)`.
- `score_reason`: one line justifying the score.

**`<repo>-security-summary.csv`** — one row per distinct finding, ordered by risk **descending**.
Header (8 cols), exactly:
```
Immediate action,Future action,PR,Risk,Routes,What's exposed / residual,Affected routes (all),Exact score_reason
```
- `Immediate action`: `Review` / `No` / `No (resolved)`.
- `Routes`: count of affected routes; `Affected routes (all)`: `METHOD /path` list joined with ` · `.
- Only include real findings (Info rows that are genuinely clean stay in the detail CSV, not the summary),
  plus any resolved/verified items worth recording.

### 7. Validate
Run the column-consistency check and fix any row that doesn't match the header width:

```bash
cd tools-auth-audit && python3 -c "
import csv
for f in ['reports/security/<repo>-security.csv','reports/security/<repo>-security-summary.csv']:
    with open(f, newline='') as fh: rows=list(csv.reader(fh))
    ncol=len(rows[0]); bad=[(i+2,len(r)) for i,r in enumerate(rows[1:]) if len(r)!=ncol]
    print(f,'| cols:',ncol,'| rows:',len(rows)-1,'| bad:',bad)
"
```
All `bad` lists must be empty before you report done.

## Rules
- Evidence-first: cite `file.scala#Lnn` for every finding and every "None identified" claim. If you
  haven't read it, don't assert it.
- Prefer the custom search/read tools over raw shell for reading code.
- Don't over-escalate: an authenticated, CORS-and-JSON-mitigated missing CSRF token is Info/Low, not High.
- Don't create extra docs/markdown — just the two CSVs, unless asked.
- One repo per run; report a short summary of findings by severity when finished.
