import { describe, expect, it } from 'vitest';
import { fetchActivity, filterPublic, paginate, type Client, type FetchPage } from './activity.ts';
import { makeCollection, makeCommitRepo, makeIssue, makePullRequest, makeReview } from './test-fixtures.ts';

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
          makeIssue({
            issue: {
              number: 1,
              title: 'Issue title',
              url: 'https://github.com/foo/private/issues/1',
              state: 'OPEN',
              repository: { nameWithOwner: 'foo/private', visibility: 'PRIVATE' },
            },
          }),
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
        nodes: [
          makeIssue(),
          makeIssue({
            issue: {
              number: 2,
              title: 'Two',
              url: 'https://github.com/foo/bar/issues/2',
              state: 'CLOSED',
              repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
            },
          }),
        ],
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

describe('fetchActivity', () => {
  it('drops null contribution nodes returned by GitHub for restricted entries', async () => {
    const collectionWithNulls = {
      hasAnyRestrictedContributions: true,
      issueContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makeIssue(), null, makeIssue({ isRestricted: true }), null],
      },
      pullRequestContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makePullRequest(), null],
      },
      pullRequestReviewContributions: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [makeReview(), null],
      },
      commitContributionsByRepository: [
        { contributions: { totalCount: 1 }, repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' } },
      ],
    };
    const client = {
      graphql: async <T>() => {
        return { user: { contributionsCollection: collectionWithNulls } } as T;
      },
    } as unknown as Client;
    const result = await fetchActivity(client, 'octocat', {
      from: new Date('2026-06-01T00:00:00Z'),
      to: new Date('2026-07-01T00:00:00Z'),
    });
    expect(result.issues).toHaveLength(1);
    expect(result.pullRequests).toHaveLength(1);
    expect(result.reviews).toHaveLength(1);
    expect(result.hasRestrictedContributions).toBe(true);
  });
});