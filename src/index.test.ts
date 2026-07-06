import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  filterPublic,
  formatReport,
  paginate,
  previousMonthRange,
  resolveDateRange,
  run,
  writeReport,
  type FetchPage,
  type FilteredActivity,
} from './index.ts';
import type {
  CommitContributionRepository,
  ContributionsCollection,
  IssueContribution,
  PullRequestContribution,
  PullRequestReviewContribution,
} from './query.ts';

function makeIssue(overrides: Partial<IssueContribution> = {}): IssueContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    issue: { number: 1, title: 'Issue title', url: 'https://github.com/foo/bar/issues/1', state: 'OPEN' },
    repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    ...overrides,
  };
}

function makePullRequest(overrides: Partial<PullRequestContribution> = {}): PullRequestContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    pullRequest: {
      number: 2,
      title: 'PR title',
      url: 'https://github.com/foo/bar/pull/2',
      state: 'OPEN',
    },
    repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    ...overrides,
  };
}

function makeReview(overrides: Partial<PullRequestReviewContribution> = {}): PullRequestReviewContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    pullRequest: { number: 3, title: 'PR title', url: 'https://github.com/foo/bar/pull/3' },
    repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    ...overrides,
  };
}

function makeCommitRepo(
  nameWithOwner: string,
  totalCount: number,
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL' = 'PUBLIC',
): CommitContributionRepository {
  return {
    contributions: { totalCount },
    repository: { nameWithOwner, visibility },
  };
}

function makeCollection(overrides: Partial<ContributionsCollection> = {}) {
  return {
    hasAnyRestrictedContributions: false,
    issueContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    pullRequestContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    pullRequestReviewContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    commitContributionsByRepository: [],
    ...overrides,
  };
}

describe('previousMonthRange', () => {
  it('returns the first day of last month to the first day of this month', () => {
    const now = new Date('2026-06-15T12:34:56Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('handles year boundary: January rolls back to December of previous year', () => {
    const now = new Date('2026-01-05T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles leap year February with thirty days of January', () => {
    const now = new Date('2024-03-15T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2024-03-01T00:00:00.000Z');
  });

  it('handles March 1 boundary where February is non-leap', () => {
    const now = new Date('2025-03-01T00:00:00Z');
    const range = previousMonthRange(now);
    expect(range.from.toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2025-03-01T00:00:00.000Z');
  });
});

describe('resolveDateRange', () => {
  it('falls back to previous month when inputs are empty', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const range = resolveDateRange('', '', now);
    expect(range.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('parses explicit from/to inputs', () => {
    const range = resolveDateRange('2026-01-01', '2026-02-01');
    expect(range.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('rejects malformed inputs', () => {
    expect(() => resolveDateRange('not-a-date', '2026-02-01')).toThrow(/Invalid date/);
    expect(() => resolveDateRange('2026-13-01', '2026-02-01')).toThrow(/Invalid date/);
  });

  it('rejects to <= from', () => {
    expect(() => resolveDateRange('2026-02-01', '2026-02-01')).toThrow(/must be after/);
    expect(() => resolveDateRange('2026-03-01', '2026-02-01')).toThrow(/must be after/);
  });
});

describe('filterPublic', () => {
  it('returns empty activity when input is null', () => {
    expect(filterPublic(null)).toEqual({
      issues: [],
      pullRequests: [],
      reviews: [],
      commits: [],
      hasRestrictedContributions: false,
    });
  });

  it('drops restricted and non-public contributions', () => {
    const collection = makeCollection({
      hasAnyRestrictedContributions: true,
      issueContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          makeIssue(),
          makeIssue({ isRestricted: true }),
          makeIssue({ repository: { nameWithOwner: 'foo/private', visibility: 'PRIVATE' } }),
        ],
      },
      pullRequestContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makePullRequest()],
      },
      pullRequestReviewContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makeReview({ repository: { nameWithOwner: 'foo/internal', visibility: 'INTERNAL' } })],
      },
      commitContributionsByRepository: [
        makeCommitRepo('foo/bar', 5, 'PUBLIC'),
        makeCommitRepo('foo/private', 3, 'PRIVATE'),
      ],
    });
    const result = filterPublic(collection);
    expect(result.issues).toHaveLength(1);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.reviews).toHaveLength(0);
    expect(result.commits.map((c) => c.repository.nameWithOwner)).toEqual(['foo/bar']);
    expect(result.hasRestrictedContributions).toBe(true);
  });

  it('passes through all-public contributions untouched', () => {
    const collection = makeCollection({
      issueContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makeIssue(), makeIssue({ issue: { number: 2, title: 'Two', url: 'https://github.com/foo/bar/issues/2', state: 'CLOSED' } })],
      },
      pullRequestContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makePullRequest()],
      },
      pullRequestReviewContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makeReview()],
      },
      commitContributionsByRepository: [makeCommitRepo('foo/bar', 7)],
    });
    const result = filterPublic(collection);
    expect(result.issues).toHaveLength(2);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.commits).toHaveLength(1);
  });
});

describe('formatReport', () => {
  const meta = {
    login: 'ilteoood',
    from: new Date('2026-06-01T00:00:00Z'),
    to: new Date('2026-07-01T00:00:00Z'),
  };

  it('renders the documented Markdown shape for a populated activity', () => {
    const activity: FilteredActivity = {
      hasRestrictedContributions: false,
      issues: [
        makeIssue({
          occurredAt: '2026-06-20T10:00:00Z',
          issue: { number: 123, title: 'First issue', url: 'https://github.com/foo/bar/issues/123', state: 'OPEN' },
          repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
        }),
        makeIssue({
          occurredAt: '2026-06-10T10:00:00Z',
          issue: { number: 1, title: 'Second', url: 'https://github.com/baz/qux/issues/1', state: 'CLOSED' },
          repository: { nameWithOwner: 'baz/qux', visibility: 'PUBLIC' },
        }),
      ],
      pullRequests: [
        makePullRequest({
          pullRequest: {
            number: 456,
            title: 'A PR',
            url: 'https://github.com/baz/qux/pull/456',
            state: 'MERGED',
          },
          repository: { nameWithOwner: 'baz/qux', visibility: 'PUBLIC' },
        }),
      ],
      reviews: [
        makeReview({
          pullRequest: { number: 789, title: 'Reviewed PR', url: 'https://github.com/foo/bar/pull/789' },
          repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
        }),
      ],
      commits: [makeCommitRepo('foo/bar', 7), makeCommitRepo('baz/qux', 10)],
    };
    const markdown = formatReport(activity, meta);
    expect(markdown).toBe(`# Open source activity — June 2026

**User:** @ilteoood
**Period:** 2026-06-01 → 2026-06-30

## Summary
- 2 issues opened across 2 repos
- 1 PRs opened across 1 repos
- 1 PR reviews submitted across 1 repos
- 17 commits on default branches across 2 repos

## Issues opened
(2)
- [foo/bar#123 — First issue](https://github.com/foo/bar/issues/123) — OPEN
- [baz/qux#1 — Second](https://github.com/baz/qux/issues/1) — CLOSED

## Pull requests opened
(1)
- [baz/qux#456 — A PR](https://github.com/baz/qux/pull/456) — MERGED

## PR reviews submitted
(1)
- [foo/bar#789 — Reviewed PR](https://github.com/foo/bar/pull/789)

## Commits on default branch
(17)
- foo/bar: 7
- baz/qux: 10
`);
  });

  it('renders placeholder sections when activity is empty', () => {
    const markdown = formatReport(
      { issues: [], pullRequests: [], reviews: [], commits: [], hasRestrictedContributions: false },
      meta,
    );
    expect(markdown).toContain('## Issues opened\n_None._');
    expect(markdown).toContain('## Pull requests opened\n_None._');
    expect(markdown).toContain('## PR reviews submitted\n_None._');
    expect(markdown).toContain('## Commits on default branch\n_None._');
  });

  it('orders issues by occurredAt descending', () => {
    const activity: FilteredActivity = {
      issues: [
        makeIssue({
          occurredAt: '2026-06-01T00:00:00Z',
          issue: { number: 1, title: 'Older', url: 'https://github.com/foo/bar/issues/1', state: 'OPEN' },
        }),
        makeIssue({
          occurredAt: '2026-06-20T00:00:00Z',
          issue: { number: 2, title: 'Newer', url: 'https://github.com/foo/bar/issues/2', state: 'OPEN' },
        }),
      ],
      pullRequests: [],
      reviews: [],
      commits: [],
      hasRestrictedContributions: false,
    };
    const markdown = formatReport(activity, meta);
    const issueSection = markdown.split('## Issues opened\n')[1]!.split('## Pull requests')[0]!;
    expect(issueSection.indexOf('Newer')).toBeLessThan(issueSection.indexOf('Older'));
  });
});

describe('paginate', () => {
  it('returns collected nodes across multiple pages', async () => {
    const calls: (string | null)[] = [];
    const fetchPage: FetchPage<number> = async (after) => {
      calls.push(after);
      if (after === null) {
        return { nodes: [1, 2], pageInfo: { hasNextPage: true, endCursor: 'cursor-1' } };
      }
      if (after === 'cursor-1') {
        return { nodes: [3], pageInfo: { hasNextPage: true, endCursor: 'cursor-2' } };
      }
      return { nodes: [4], pageInfo: { hasNextPage: false, endCursor: null } };
    };
    const result = await paginate(fetchPage);
    expect(result).toEqual([1, 2, 3, 4]);
    expect(calls).toEqual([null, 'cursor-1', 'cursor-2']);
  });

  it('returns empty array when the first page is empty', async () => {
    const fetchPage: FetchPage<number> = async () => ({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await paginate(fetchPage)).toEqual([]);
  });

  it('stops iterating when hasNextPage is false even if endCursor is non-null', async () => {
    let calls = 0;
    const fetchPage: FetchPage<number> = async () => {
      calls += 1;
      return { nodes: [calls], pageInfo: { hasNextPage: false, endCursor: 'unused' } };
    };
    const result = await paginate(fetchPage);
    expect(result).toEqual([1]);
    expect(calls).toBe(1);
  });

  it('returns single page when hasNextPage is false on the first page', async () => {
    const fetchPage: FetchPage<number> = async () => ({
      nodes: [42],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
    expect(await paginate(fetchPage)).toEqual([42]);
  });
});

describe('writeReport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `sauce-reporter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  });

  it('writes content to the requested path and returns it', () => {
    const filePath = writeReport('hello', { outputDir: tempDir, fileName: '2026-06.md' });
    assert.equal(filePath, join(tempDir, '2026-06.md'));
    assert.equal(readFileSync(filePath, 'utf8'), 'hello');
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates nested directories that do not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'reports');
    const filePath = writeReport('content', { outputDir: nestedDir, fileName: '2026-06.md' });
    assert.ok(existsSync(filePath));
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('run integration', () => {
  it('orchestrates end-to-end against a mocked GraphQL client', async () => {
    const tempDir = join(tmpdir(), `sauce-reporter-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const fetches: unknown[] = [];
    const emptyConnection = { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] };
    const commitBlock = [
      {
        contributions: { totalCount: 3 },
        repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
      },
    ];
    const issueBlock = {
      hasAnyRestrictedContributions: false,
      issueContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            occurredAt: '2026-06-15T10:00:00Z',
            isRestricted: false,
            issue: { number: 1, title: 'Issue', url: 'https://github.com/foo/bar/issues/1', state: 'OPEN' },
            repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
          },
        ],
      },
      pullRequestContributions: emptyConnection,
      pullRequestReviewContributions: emptyConnection,
      commitContributionsByRepository: [],
    };
    const commitResponse = {
      user: {
        contributionsCollection: {
          hasAnyRestrictedContributions: false,
          issueContributions: emptyConnection,
          pullRequestContributions: emptyConnection,
          pullRequestReviewContributions: emptyConnection,
          commitContributionsByRepository: commitBlock,
        },
      },
    };
    const client = {
      graphql: async <T>(query: string, variables: T) => {
        fetches.push({ query, variables });
        if (query.includes('viewer')) {
          return { viewer: { login: 'octocat' } };
        }
        const v = variables as Record<string, unknown>;
        if ('issueAfter' in v) {
          return { user: { contributionsCollection: issueBlock } };
        }
        return commitResponse;
      },
    } as unknown as Parameters<typeof run>[0]['client'];
    const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-07-01T00:00:00Z') };
    const result = await run({
      token: 'fake-token',
      fromInput: '2026-06-01',
      toInput: '2026-07-01',
      outputDir: tempDir,
      client,
    });
    expect(result.login).toBe('octocat');
    expect(result.range).toEqual(range);
    const written = readFileSync(result.filePath, 'utf8');
    expect(written).toContain('# Open source activity — June 2026');
    expect(written).toContain('**User:** @octocat');
    expect(written).toContain('foo/bar#1 — Issue');
    expect(written).toContain('foo/bar: 3');
    rmSync(tempDir, { recursive: true, force: true });
  });
});