import { strict as assert } from 'node:assert';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
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
    const { filePath, ...rest } = result;
    assert.deepStrictEqual(rest, { login: 'octocat', range });
    const written = readFileSync(filePath, 'utf8');
    assert.ok(written.includes('# Open source activity — June 2026'));
    assert.ok(written.includes('**User:** @octocat'));
    assert.ok(written.includes('foo/bar#1 — Issue'));
    assert.ok(written.includes('foo/bar: 3'));
    rmSync(tempDir, { recursive: true, force: true });
  });
});

describe('parseExcludeRepositories', () => {
  it('trims, lowercases, drops empty entries', () => {
    assert.deepStrictEqual(
      parseExcludeRepositories(' me/DotFiles, ,, work/Mirror '),
      new Set(['me/dotfiles', 'work/mirror']),
    );
  });

  it('returns an empty set for undefined, empty, or comma-only input', () => {
    assert.strictEqual(parseExcludeRepositories(undefined).size, 0);
    assert.strictEqual(parseExcludeRepositories('').size, 0);
    assert.strictEqual(parseExcludeRepositories(',,,').size, 0);
  });
});
