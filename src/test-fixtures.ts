import type {
  CommitContributionRepository,
  ContributionsCollection,
  IssueContribution,
  PullRequestContribution,
  PullRequestReviewContribution,
} from './query.ts';

export function makeIssue(overrides: Partial<IssueContribution> = {}): IssueContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    issue: {
      number: 1,
      title: 'Issue title',
      url: 'https://github.com/foo/bar/issues/1',
      state: 'OPEN',
      repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    },
    ...overrides,
  };
}

export function makePullRequest(overrides: Partial<PullRequestContribution> = {}): PullRequestContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    pullRequest: {
      number: 2,
      title: 'PR title',
      url: 'https://github.com/foo/bar/pull/2',
      state: 'OPEN',
      repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    },
    ...overrides,
  };
}

export function makeReview(overrides: Partial<PullRequestReviewContribution> = {}): PullRequestReviewContribution {
  return {
    occurredAt: '2026-06-15T10:00:00Z',
    isRestricted: false,
    pullRequest: { number: 3, title: 'PR title', url: 'https://github.com/foo/bar/pull/3' },
    repository: { nameWithOwner: 'foo/bar', visibility: 'PUBLIC' },
    ...overrides,
  };
}

export function makeCommitRepo(
  nameWithOwner: string,
  totalCount: number,
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL' = 'PUBLIC',
): CommitContributionRepository {
  return {
    contributions: { totalCount },
    repository: { nameWithOwner, visibility },
  };
}

export function makeCollection(overrides: Partial<ContributionsCollection> = {}): ContributionsCollection {
  return {
    hasAnyRestrictedContributions: false,
    issueContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    pullRequestContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    pullRequestReviewContributions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] },
    commitContributionsByRepository: [],
    ...overrides,
  };
}