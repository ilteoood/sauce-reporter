import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { deriveReportFileName, formatReport, writeReport } from './report.ts';
import type { FilteredActivity } from './activity.ts';
import { makeCommitRepo, makeIssue, makePullRequest, makeReview } from './test-fixtures.ts';

const meta = {
  login: 'ilteoood',
  from: new Date('2026-06-01T00:00:00Z'),
  to: new Date('2026-06-30T00:00:00Z'),
};

describe('formatReport', () => {
  it('renders the documented Markdown shape for a populated activity', () => {
    const activity: FilteredActivity = {
      hasRestrictedContributions: false,
      issues: [
        makeIssue({
          occurredAt: '2026-06-20T10:00:00Z',
          issue: {
            number: 123,
            title: 'First issue',
            url: 'https://github.com/foo/bar/issues/123',
            state: 'OPEN',
            repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
          },
        }),
        makeIssue({
          occurredAt: '2026-06-10T10:00:00Z',
          issue: {
            number: 1,
            title: 'Second',
            url: 'https://github.com/baz/qux/issues/1',
            state: 'CLOSED',
            repository: { nameWithOwner: 'baz/qux', visibility: 'PUBLIC' },
          },
        }),
      ],
      pullRequests: [
        makePullRequest({
          pullRequest: {
            number: 456,
            title: 'A PR',
            url: 'https://github.com/baz/qux/pull/456',
            state: 'MERGED',
            repository: { nameWithOwner: 'baz/qux', visibility: 'PUBLIC' },
          },
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
          issue: {
            number: 1,
            title: 'Older',
            url: 'https://github.com/foo/bar/issues/1',
            state: 'OPEN',
            repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
          },
        }),
        makeIssue({
          occurredAt: '2026-06-20T00:00:00Z',
          issue: {
            number: 2,
            title: 'Newer',
            url: 'https://github.com/foo/bar/issues/2',
            state: 'OPEN',
            repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
          },
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

  it('shows the inclusive `to` date in the period header without shifting it back a day', () => {
    const activity: FilteredActivity = {
      issues: [],
      pullRequests: [],
      reviews: [],
      commits: [],
      hasRestrictedContributions: false,
    };
    const metaEnd = {
      login: 'ilteoood',
      from: new Date('2026-07-01T00:00:00Z'),
      to: new Date('2026-07-31T00:00:00Z'),
    };
    const markdown = formatReport(activity, metaEnd);
    expect(markdown).toContain('**Period:** 2026-07-01 → 2026-07-31');
  });
});

describe('deriveReportFileName', () => {
  it('returns YYYY-MM.md for a month start', () => {
    expect(deriveReportFileName(new Date('2026-06-01T00:00:00Z'))).toBe('2026-06.md');
    expect(deriveReportFileName(new Date('2025-01-01T00:00:00Z'))).toBe('2025-01.md');
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