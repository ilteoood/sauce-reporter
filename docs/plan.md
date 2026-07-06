# Plan — Monthly Open Source Activity Reporter

## Goal

A script that runs monthly, identifies the authenticated GitHub user, fetches **all** of their public open-source activity over a given timespan (cursor-paginated, no truncation), and writes a Markdown report into the repo. Private organizations and repositories are excluded.

## Approach

One GraphQL query against `user.contributionsCollection(from, to)` returns the four event types in a single round-trip. Each contribution carries `repository { visibility nameWithOwner }`, so the public-only filter is a single equality check. The `viewer { login }` query resolves the authenticated user — no username argument is required.

### Why GraphQL over REST

The REST equivalent needs four separate endpoints (`/issues`, `/pulls`, `/pulls/reviews`, `/repos/{owner}/{repo}/commits`) plus a separate call per repository for commits. GraphQL returns everything for one user over one date range in one request.

### Why `ContributionsCollection` over `search`

`search(type: ISSUE, query: "author:me is:public created:...")` works but is capped at 1,000 results per query, has stricter rate limits, and requires a separate query per event type. `ContributionsCollection` is the purpose-built API surface.

## File layout

```
sauce-reporter/
├── .github/workflows/monthly-report.yml   # cron: 0 6 1 * *  (1st of month, 06:00 UTC)
├── action.yml                              # composite action manifest, inputs: from, to
├── src/index.ts                            # orchestration: dates → fetch → filter → format → write
├── src/query.ts                            # GraphQL query string + response types
├── src/index.test.ts                       # unit tests: filter, format, dates, paginate
├── package.json                            # @octokit/graphql, typescript, tsx, vitest, @types/node
├── tsconfig.json
├── .gitignore
└── README.md                               # one page: setup + re-run instructions
```

`src/index.ts` owns the pipeline. `src/query.ts` holds the GraphQL string and its types. Helpers (`filterPublic`, `formatReport`, `previousMonthRange`, `paginate`) live in `index.ts` and are unit-tested from `index.test.ts` — no extra files because each helper is small and used in one place.

## The GraphQL query

```graphql
query Activity(
  $login: String!
  $from: DateTime!
  $to: DateTime!
  $issueAfter: String
  $prAfter: String
  $reviewAfter: String
) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      hasAnyRestrictedContributions
      issueContributions(first: 100, after: $issueAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          occurredAt
          isRestricted
          issue { number title url state }
          repository { nameWithOwner visibility }
        }
      }
      pullRequestContributions(first: 100, after: $prAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          occurredAt
          isRestricted
          pullRequest { number title url state }
          repository { nameWithOwner visibility }
        }
      }
      pullRequestReviewContributions(first: 100, after: $reviewAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          occurredAt
          isRestricted
          pullRequest { number title url }
          repository { nameWithOwner visibility }
        }
      }
      commitContributionsByRepository(maxRepositories: 50) {
        contributions { totalCount }
        repository { nameWithOwner visibility }
      }
    }
  }
}
```

`first: 100` is the page size; cursor pagination collects every contribution in the `from`/`to` window, not a truncated subset. Commits are aggregated by repository and only need the per-repo cap (`maxRepositories: 50`).

## The pipeline

1. **Inputs**: `from`, `to` ISO dates from `getInput()`; default to previous calendar month if absent.
2. **Token**: `core.getInput('token') || process.env.GITHUB_TOKEN || process.env.REPORTER_TOKEN`. A PAT is required in the Action because `GITHUB_TOKEN` only sees the current repository.
3. **Resolve login**: `viewer { login }` once, before the main query.
4. **Fetch**: paginate the three contribution connections (issues, PRs, PR reviews). Each loop follows `pageInfo.hasNextPage` and re-issues the query with `after: <endCursor>` until exhausted. Commits are fetched once — they come aggregated by repository.
5. **Filter**: keep only nodes where `repository.visibility === 'PUBLIC'` and `!isRestricted`. Drop the whole `commitContributionsByRepository` entry if the repository is not public.
6. **Format**: build the Markdown (see below).
7. **Write**: `reports/YYYY-MM.md` via direct `fs.writeFileSync`, then commit and push in the workflow.

### Pagination

A single generic helper handles all three paged fields — they share the same shape (`pageInfo { hasNextPage endCursor }` + `nodes`):

```ts
async function paginate<T>(
  fetchPage: (after: string | null) => Promise<{ nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }>,
): Promise<T[]> {
  const all: T[] = [];
  let after: string | null = null;
  do {
    const page = await fetchPage(after);
    all.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after !== null);
  return all;
}
```

Each contribution type passes its own `fetchPage` closure that supplies the correct GraphQL variable (`$issueAfter`, `$prAfter`, `$reviewAfter`). The three fetches run sequentially — there is no rate-limit benefit to parallelizing, and sequential keeps the test fixtures small.

## Markdown shape

```markdown
# Open source activity — June 2026

**User:** @ilteoood
**Period:** 2026-06-01 → 2026-06-30

## Summary
- 5 issues opened across 3 repos
- 2 PRs opened across 2 repos
- 4 PR reviews submitted across 2 repos
- 17 commits on default branches across 4 repos

## Issues opened (5)
- [foo/bar#123 — Title](url) — OPEN
- ...

## Pull requests opened (2)
- [baz/qux#456 — Title](url) — MERGED
- ...

## PR reviews submitted (4)
- [foo/bar#789 — Title](url)
- ...

## Commits on default branch (17)
- foo/bar: 7
- baz/qux: 10
```

Within each section: sort by `occurredAt` descending. Group commits by repository (the API already does this).

## Testing

`vitest` as the runner — fast, native TS, no transpile config. Tests live colocated as `src/index.test.ts`.

| Helper | What it asserts |
|---|---|
| `previousMonthRange(now)` | Returns `[firstDayOfLastMonth, firstDayOfThisMonth)` for an arbitrary `now`; stable across month boundaries and leap years. |
| `filterPublic(contributions)` | Drops nodes where `repository.visibility !== 'PUBLIC'`, drops `isRestricted` nodes, drops non-public `commitContributionsByRepository` entries. Empty input → empty output. |
| `formatReport(activity, { login, from, to })` | Produces the exact Markdown shape above, including the summary counts. Golden-string assertion against the format, no snapshot files. |
| `paginate(fetchPage)` | Iterates until `hasNextPage` is false; collects every node across pages; passes the previous `endCursor` as the next `after`. Mock `fetchPage` returns scripted pages to drive each branch (single page, multi-page, empty, cursor-not-null-on-last-page edge case). |

### CI

The workflow gains a `test` job that runs `npm test` on every push and PR, in parallel with the existing scheduled `report` job. No secrets required for tests.

### Skipped (add when)

- **Integration tests against a real GitHub account** — requires a token in CI and a fixture repo to keep stable. Add when the report format stabilizes enough to need a regression net beyond unit tests.
- **Snapshot tests** — golden-string asserts are more readable than `.snap` files for a flat Markdown report.

## Workflow

```yaml
on:
  schedule:
    - cron: '0 6 1 * *'      # 1st of month, 06:00 UTC
  workflow_dispatch:
    inputs:
      from:
        description: 'ISO date (YYYY-MM-DD), defaults to previous month'
        required: false
      to:
        description: 'ISO date (YYYY-MM-DD), defaults to previous month'
        required: false

permissions:
  contents: write            # to commit the report

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./                              # the composite action
        with:
          token: ${{ secrets.REPORTER_TOKEN }}
          from: ${{ inputs.from }}
          to:   ${{ inputs.to }}
      - run: |
          git config user.name "sauce-reporter[bot]"
          git config user.email "sauce-reporter[bot]@users.noreply.github.com"
          git add reports/
          git diff --cached --quiet || git commit -m "report: $(date -u +%Y-%m)"
          git push
```

## One-time setup

1. Generate a fine-grained PAT (Settings → Developer settings → Personal access tokens, Fine-grained tokens) with `metadata: read` and `profile: read`. A classic PAT with `read:user` and `public_repo` works as a fallback.
2. Add it as the repository secret `REPORTER_TOKEN`.
3. The Action has `permissions: contents: write` to commit the report back to the repository.
4. Re-run with custom dates: Actions tab → monthly-report → Run workflow → fill `from` / `to`.

## Privacy / exclusion semantics

- `repository.visibility === 'PUBLIC'` is the only gate. Private and internal repositories are dropped after the fetch, never stored, never logged.
- Private organization repositories are excluded automatically because their `visibility` is `PRIVATE` or `INTERNAL`.
- `RestrictedContribution` nodes (private contributions you cannot see) are dropped silently. The `hasAnyRestrictedContributions` flag is captured for transparency if the count is non-zero.

## Deliberately skipped (add when)

- **CLI entry point** — the Action is the runtime. A local CLI is one `bin` field in `package.json` and a `--stdout` flag away when needed.
- **Caching** — the API call is monthly and idempotent over the timespan. Caching would just add a key to manage.
- **Multi-user support** — one user, one report. Drop in a `login` input when a second user appears.

## Open questions

- **PAT type** — fine-grained (recommended, least privilege) or classic (`read:user` + `public_repo`)?
- **Commit target** — push directly to `main`, or open a `reports/YYYY-MM` branch as a PR for review?
- **Backfill** — generate one historical month on the first run, or start from the current month and let history accumulate?