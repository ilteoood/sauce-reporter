import { graphql } from '@octokit/graphql';
import {
  ACTIVITY_QUERY,
  VIEWER_QUERY,
  type ActivityResponse,
  type CommitContributionRepository,
  type ContributionsCollection,
  type IssueContribution,
  type PullRequestContribution,
  type PullRequestReviewContribution,
  type ViewerResponse,
} from './query.ts';

export interface Page<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface FetchPage<T> {
  (after: string | null): Promise<Page<T>>;
}

export async function paginate<T>(fetchPage: FetchPage<T>): Promise<T[]> {
  const collected: T[] = [];
  let after: string | null = null;
  do {
    const page = await fetchPage(after);
    collected.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after !== null);
  return collected;
}

export interface Client {
  graphql: typeof graphql;
}

export interface FilteredActivity {
  issues: IssueContribution[];
  pullRequests: PullRequestContribution[];
  reviews: PullRequestReviewContribution[];
  commits: CommitContributionRepository[];
  hasRestrictedContributions: boolean;
}

export function filterPublic(activity: ContributionsCollection | null | undefined): FilteredActivity {
  if (!activity) {
    return emptyActivity();
  }
  return {
    issues: activity.issueContributions.nodes.filter(isPublicContribution),
    pullRequests: activity.pullRequestContributions.nodes.filter(isPublicContribution),
    reviews: activity.pullRequestReviewContributions.nodes.filter(isPublicContribution),
    commits: activity.commitContributionsByRepository.filter(
      (entry: CommitContributionRepository) => entry.repository.visibility === 'PUBLIC',
    ),
    hasRestrictedContributions: activity.hasAnyRestrictedContributions,
  };
}

function emptyActivity(): FilteredActivity {
  return {
    issues: [],
    pullRequests: [],
    reviews: [],
    commits: [],
    hasRestrictedContributions: false,
  };
}

function isPublicContribution<T extends { isRestricted: boolean; repository: { visibility: string } }>(
  contribution: T,
): boolean {
  return !contribution.isRestricted && contribution.repository.visibility === 'PUBLIC';
}

export async function fetchActivity(
  client: Client,
  login: string,
  range: { from: Date; to: Date },
): Promise<FilteredActivity> {
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const issueFetcher: FetchPage<IssueContribution> = async (after) => {
    const data = await client.graphql<ActivityResponse>(ACTIVITY_QUERY, {
      login,
      from: fromIso,
      to: toIso,
      issueAfter: after,
    });
    return unwrapConnection(data, 'issueContributions');
  };

  const prFetcher: FetchPage<PullRequestContribution> = async (after) => {
    const data = await client.graphql<ActivityResponse>(ACTIVITY_QUERY, {
      login,
      from: fromIso,
      to: toIso,
      prAfter: after,
    });
    return unwrapConnection(data, 'pullRequestContributions');
  };

  const reviewFetcher: FetchPage<PullRequestReviewContribution> = async (after) => {
    const data = await client.graphql<ActivityResponse>(ACTIVITY_QUERY, {
      login,
      from: fromIso,
      to: toIso,
      reviewAfter: after,
    });
    return unwrapConnection(data, 'pullRequestReviewContributions');
  };

  const commitResponse = await client.graphql<ActivityResponse>(ACTIVITY_QUERY, {
    login,
    from: fromIso,
    to: toIso,
  });
  const collection = unwrapCollection(commitResponse);

  const [issues, pullRequests, reviews] = await Promise.all([
    paginate(issueFetcher),
    paginate(prFetcher),
    paginate(reviewFetcher),
  ]);

  const merged: ContributionsCollection | null = collection
    ? {
        ...collection,
        issueContributions: { ...collection.issueContributions, nodes: issues },
        pullRequestContributions: { ...collection.pullRequestContributions, nodes: pullRequests },
        pullRequestReviewContributions: { ...collection.pullRequestReviewContributions, nodes: reviews },
      }
    : null;

  return filterPublic(merged);
}

type ConnectionKey = 'issueContributions' | 'pullRequestContributions' | 'pullRequestReviewContributions';

function unwrapConnection<T>(response: ActivityResponse, key: ConnectionKey): Page<T> {
  const collection = unwrapCollection(response);
  const connection = collection?.[key];
  if (!connection) {
    return { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } as Page<T>;
  }
  return {
    nodes: connection.nodes as T[],
    pageInfo: connection.pageInfo,
  };
}

function unwrapCollection(response: ActivityResponse): ContributionsCollection | null {
  return response.user?.contributionsCollection ?? null;
}

export async function resolveViewer(client: Client): Promise<string> {
  const data = await client.graphql<ViewerResponse>(VIEWER_QUERY);
  if (!data.viewer) {
    throw new Error('Could not resolve authenticated user from viewer query.');
  }
  return data.viewer.login;
}