# sauce-reporter

A monthly open-source activity reporter. Runs on the first of every month, identifies the authenticated GitHub user, fetches every public contribution (issues, PRs, PR reviews, default-branch commits) for the previous calendar month, and writes a Markdown report into `reports/`.

Private repositories are filtered out after the fetch and are never stored.

## Setup

1. Generate a fine-grained personal access token (Settings → Developer settings → Personal access tokens → Fine-grained tokens) with:
   - **Metadata: read**
   - **Profile: read**

   A classic PAT with `read:user` and `public_repo` works as a fallback.

2. Add the token as the repository secret `REPORTER_TOKEN` (Settings → Secrets and variables → Actions).

3. The workflow already has `permissions: contents: write` so it can commit the report back to the repository.

4. (Optional) Re-run for a custom window: Actions tab → **Monthly Report** → **Run workflow** → fill the `from` and `to` date inputs.

## Local usage

```bash
npm install
REPORTER_TOKEN=<your-token> npm run report
```

Or override the window:

```bash
REPORTER_TOKEN=<your-token> \
INPUT_FROM=2026-01-01 INPUT_TO=2026-01-31 \
npm run report
```

## What the report contains

For each month the action writes `reports/YYYY-MM.md` with:

- **Summary** — totals across the four contribution types and distinct-repo counts.
- **Issues opened** — every public issue authored in the window, sorted newest first.
- **Pull requests opened** — every public PR authored in the window, sorted newest first.
- **PR reviews submitted** — every public PR review submitted in the window.
- **Commits on default branch** — per-repository commit totals on the default branch.

Within each section items are sorted by `occurredAt` descending. Sections render `_None._` when empty.

## Privacy

Only `repository.visibility === 'PUBLIC'` contributions make it into the report. `isRestricted` nodes are dropped. The `hasAnyRestrictedContributions` flag is captured for transparency but is not currently surfaced in the Markdown; add it to the report when needed.

## Development

```bash
npm install
npm run lint   # typecheck
npm test       # node:test
```

Tests live in `src/index.test.ts` and cover the date math, the public-only filter, the Markdown formatter, and the paginator (no network calls).

## Architecture

- `src/query.ts` — GraphQL query strings and response types.
- `src/index.ts` — pipeline: date resolution → viewer lookup → paginated fetch → public-only filter → Markdown → write.
- `action.yml` — composite action manifest; the workflow calls it via `./`.
- `.github/workflows/monthly-report.yml` — schedule + `workflow_dispatch` triggers; runs `npm test` on every push.

## Deliberate non-goals

- **Multi-user reports** — one user, one report. Drop in a `login` input when a second user appears.
- **CLI binary** — the action is the runtime; a `bin` entry is one field away when needed.
- **Caching** — the API call is monthly and idempotent over the window. A cache would add a key to manage with no payoff.