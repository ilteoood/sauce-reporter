import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseExcludeRepositories, run } from './index.ts';

describe('run integration', () => {
  it('orchestrates end-to-end against a mocked GraphQL client', async () => {
    const tempDir = join(tmpdir(), `sauce-reporter-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
            issue: {
              number: 1,
              title: 'Issue',
              url: 'https://github.com/foo/bar/issues/1',
              state: 'OPEN',
              repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
            },
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
    const range = { from: new Date('2026-06-01T00:00:00Z'), to: new Date('2026-06-30T23:59:59.999Z') };
    const result = await run({
      token: 'fake-token',
      fromInput: '2026-06-01',
      toInput: '2026-06-30',
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

describe('parseExcludeRepositories', () => {
  it('trims, lowercases, drops empty entries', () => {
    expect(parseExcludeRepositories(' me/DotFiles, ,, work/Mirror ')).toEqual(
      new Set(['me/dotfiles', 'work/mirror']),
    );
  });

  it('returns an empty set for undefined, empty, or comma-only input', () => {
    expect(parseExcludeRepositories(undefined).size).toBe(0);
    expect(parseExcludeRepositories('').size).toBe(0);
    expect(parseExcludeRepositories(',,,').size).toBe(0);
  });
});