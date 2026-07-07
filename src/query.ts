export const ACTIVITY_QUERY = /* GraphQL */ `
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
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            occurredAt
            isRestricted
            issue {
              number
              title
              url
              state
              repository {
                nameWithOwner
                visibility
              }
            }
          }
        }
        pullRequestContributions(first: 100, after: $prAfter) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            occurredAt
            isRestricted
            pullRequest {
              number
              title
              url
              state
              repository {
                nameWithOwner
                visibility
              }
            }
          }
        }
        pullRequestReviewContributions(first: 100, after: $reviewAfter) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            occurredAt
            isRestricted
            pullRequest {
              number
              title
              url
            }
            repository {
              nameWithOwner
              visibility
            }
          }
        }
        commitContributionsByRepository(maxRepositories: 50) {
          contributions(first: 1) {
            totalCount
          }
          repository {
            nameWithOwner
            visibility
          }
        }
      }
    }
  }
`;

export const VIEWER_QUERY = /* GraphQL */ `
  query Viewer {
    viewer {
      login
    }
  }
`;

export type Visibility = 'PUBLIC' | 'PRIVATE' | 'INTERNAL' | 'UNKNOWN';

export interface RepositoryRef {
  nameWithOwner: string;
  visibility: Visibility;
}

export interface IssueRef {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  repository: RepositoryRef;
}

export interface PullRequestRef {
  number: number;
  title: string;
  url: string;
  state?: 'OPEN' | 'CLOSED' | 'MERGED';
  repository: RepositoryRef;
}

export interface IssueContribution {
  occurredAt: string;
  isRestricted: boolean;
  issue: IssueRef;
}

export interface PullRequestContribution {
  occurredAt: string;
  isRestricted: boolean;
  pullRequest: PullRequestRef;
}

export interface PullRequestReviewContribution {
  occurredAt: string;
  isRestricted: boolean;
  pullRequest: Pick<PullRequestRef, 'number' | 'title' | 'url'>;
  repository: RepositoryRef;
}

export interface CommitContributionRepository {
  contributions: { totalCount: number };
  repository: RepositoryRef;
}

export interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: (T | null)[];
}

export interface ContributionsCollection {
  hasAnyRestrictedContributions: boolean;
  issueContributions: Connection<IssueContribution>;
  pullRequestContributions: Connection<PullRequestContribution>;
  pullRequestReviewContributions: Connection<PullRequestReviewContribution>;
  commitContributionsByRepository: CommitContributionRepository[];
}

export interface ActivityData {
  user: {
    contributionsCollection: ContributionsCollection;
  } | null;
}

export interface ActivityVariables {
  login: string;
  from: string;
  to: string;
  issueAfter?: string | null;
  prAfter?: string | null;
  reviewAfter?: string | null;
}

export interface ViewerData {
  viewer: { login: string } | null;
}

export type ActivityResponse = ActivityData;
export type ViewerResponse = ViewerData;