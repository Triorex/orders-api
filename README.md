# orders-api

A small order service (Node.js 26, Express 5) on the **Triorex paved road**. It is the golden
template for Node services: the second stack on the same central pipeline as
[payments-api](https://github.com/Triorex/payments-api), with no security logic of its own.

| Endpoint | Purpose |
|---|---|
| `POST /orders` | Create an order (strictly validated; the server computes the total) |
| `GET /orders/{id}` | Fetch one order |
| `GET /orders?customer_id=` | List a customer's orders |
| `POST /orders/{id}/cancel` | Cancel a pending order |
| `GET /healthz` | Liveness and readiness |
| `GET /openapi.json` | API schema, used by the DAST API scan |

## How security is wired in

This repo owns **one** CI file, [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It calls the
central reusable workflows at a pinned commit; nothing security-related is implemented here.
The paved-road files were rendered by the platform's fleet onboarding (`fleet/onboard.py`); this
repo changes two inputs: Node 26 for tests (to match the runtime image) and the OpenAPI-driven DAST scan.

| Stage | What runs (from the platform) |
|---|---|
| Pull request | Secrets, SAST (CodeQL JavaScript, Semgrep), dependency review, SCA, package curation, IaC, workflow security, Kyverno policy check, exception expiry → one required check `pr-security / gate` |
| Build (main, or any branch on demand) | Tests on Node 26 → Hadolint → build on Chainguard → Trivy + Dockle → SBOM, keyless signature, SLSA provenance |
| dev | Every main build, or any branch with **Run workflow**; developer testing, no approval |
| staging | Main only: kind + Kyverno admission (signed admitted, unsigned denied), these manifests deployed at the digest, OWASP ZAP API scan → signed DAST attestation |
| QA sign-off | `qa` team approves after testing in staging → signed QA attestation |
| production | `appsec` approval; staging, DAST and QA evidence re-verified for the same digest; forward-only → GitHub Release |
| Daily | Vulnerability triage (KEV + EPSS → issues with SLA), Scorecard, Dependabot |

## Choices worth knowing

- **One runtime dependency.** Express 5 only (65 packages in the lock). Tests use Node's built-in
  test runner and `fetch`, so there are no dev dependencies to curate or patch.
- **Lockfile with integrity hashes, no install scripts.** `npm ci` installs exactly
  `package-lock.json` (sha512 per package); [`.npmrc`](.npmrc) sets `ignore-scripts=true`, which
  closes the path the 2025 npm worm used, and `min-release-age=7` makes npm itself refuse versions
  newer than 7 days, the same cooldown the curation gate enforces in CI. (Semgrep's
  `npm-missing-minimum-release-age` rule flagged the first draft without it.)
- **Sandboxed process.** The image starts Node with its permission model:
  `--permission --allow-fs-read=/app/ --allow-net --disallow-code-generation-from-strings`.
  The process cannot write files, read outside `/app`, spawn child processes, start workers, load
  native addons or `eval` strings, so a remote code execution bug has very little to work with.
  (`--allow-net` is still marked experimental in Node 26 and logs a warning at startup.)
- **Read-only, non-root.** Chainguard runtime image pinned by digest, `USER 65532`, read-only root
  filesystem, all capabilities dropped, no writable volume. A NetworkPolicy allows HTTP in and
  nothing out. Zero known CVEs at build time.
- **Residual risk:** the Chainguard Node runtime still contains npm and a busybox shell. The app
  never calls them and the permission model blocks spawning them; a slimmer image built with apko
  (node only) is on the roadmap.
- **API hygiene.** Allow-list validation with unknown fields rejected (no mass assignment of
  `status` or `total`, no `__proto__`), money in integer cents, a `Map` store (no prototype
  reachability), JSON-only with a 16 KB body limit, security headers, no `X-Powered-By`, no stack
  traces in errors.

## Local development

```sh
npm ci                                   # exact lockfile, no install scripts
npm test                                 # node --test (Node 26)
pre-commit install                       # gitleaks, Semgrep, Hadolint before every commit
docker build -t orders-api . && docker run --rm --read-only --cap-drop ALL -p 8080:8080 orders-api
```

Risk exceptions go in [`.security/exceptions.yaml`](.security/exceptions.yaml) (AppSec review, 90-day maximum).
