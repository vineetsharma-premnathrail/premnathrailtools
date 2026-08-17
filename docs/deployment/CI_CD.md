# CI/CD

**There is no CI/CD pipeline currently configured in this repo.** There
is no `.github/workflows/` directory (confirmed absent) and no other CI
config (no `.gitlab-ci.yml`, `azure-pipelines.yml`, `Jenkinsfile`, etc.).
Building, testing, and deploying are all manual today:

- Tests are run locally: `pytest app/tests` (backend), no frontend test
  suite exists in `frontend/package.json`
- Linting is run locally: `npm run lint` (frontend); no configured
  Python linter/formatter command was found wired into a script
- The Docker image (see [DOCKER.md](DOCKER.md)) is built and pushed by
  hand, and deployed by hand (see [DEPLOYMENT.md](DEPLOYMENT.md))

The `backend/app/middleware/owasp.py` module's own header comment notes
that A06 (Outdated Components) is "enforced via pip-audit in CI (not
middleware)" — but no such CI job actually exists in this repo yet. That
comment describes an intended practice, not a current one; treat
`pip-audit` as a manual step until a workflow is added.

## Recommended minimal pipeline

If/when CI is added, a minimal `.github/workflows/ci.yml` covering both
halves of the app would look like:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -r backend/requirements.txt
      - run: pip install pip-audit
      - run: pip-audit -r backend/requirements.txt
        continue-on-error: true   # flag known CVEs without blocking merges initially
      - run: cd backend && pytest app/tests -v

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: cd frontend && npm ci
      - run: cd frontend && npm run lint
      - run: cd frontend && npm run build
```

This is a proposal, not something currently running — it matches the
real dependency versions in `backend/requirements.txt` (Python 3.12, per
the Dockerfile's base image) and `frontend/package.json` (Node 22, per
the Dockerfile). Adjust as the project's actual test coverage grows
(there is currently no frontend test runner configured, so no `npm test`
step is included above).

## Image publishing

There is no automated image build/push (no registry workflow). Building
and pushing `premnathrail-portal:latest` (or a tagged version) is a
manual `docker build` / `docker push` today — see
[DOCKER.md](DOCKER.md).

## Things confirmed absent

- No `.github/workflows/` directory
- No other CI system config file
- No automated `pip-audit` / dependency-scanning job (despite being
  referenced in a code comment as the intended enforcement point for A06)
- No automated Docker image build/push
- No automated deployment step of any kind

---

**See also:** [DEPLOYMENT.md](DEPLOYMENT.md), [DOCKER.md](DOCKER.md).
