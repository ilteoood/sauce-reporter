import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as core from '@actions/core';
import { graphql } from '@octokit/graphql';
import {
  ACTIVITY_QUERY,
  VIEWER_QUERY,
  type ActivityResponse,
  type ActivityVariables,
  type CommitContributionRepository,
  type ContributionsCollection,
  type IssueContribution,
  type PullRequestContribution,
  type PullRequestReviewContribution,
  type ViewerResponse,
} from './query.ts';

export interface DateRange {
  from: Date;
  to: Date;
}

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

export function previousMonthRange(now: Date): DateRange {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from, to };
}

export function resolveDateRange(fromInput: string, toInput: string, now: Date = new Date()): DateRange {
  if (fromInput && toInput) {
    const from = parseIsoDate(fromInput);
    const to = parseIsoDate(toInput);
    if (!from || !to) {
      throw new Error(`Invalid date inputs: from=${fromInput}, to=${toInput}`);
    }
    if (to.getTime() <= from.getTime()) {
      throw new Error(`'to' must be after 'from'`);
    }
    return { from: startOfUtcDay(from), to: startOfUtcDay(to) };
  }
  return previousMonthRange(now);
}

function parseIsoDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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

export interface ReportMeta {
  login: string;
  from: Date;
  to: Date;
}

export function formatReport(activity: FilteredActivity, meta: ReportMeta): string {
  const monthLabel = formatMonthLabel(meta.from);
  const period = `${formatIsoDate(meta.from)} → ${formatIsoDate(addDays(meta.to, -1))}`;
  const summary = buildSummary(activity);

  const lines: string[] = [
    `# Open source activity — ${monthLabel}`,
    '',
    `**User:** @${meta.login}`,
    `**Period:** ${period}`,
    '',
    '## Summary',
    ...summary,
    '',
    '## Issues opened',
    ...renderSection(activity.issues.length, formatIssueLine, sortByOccurredAt(activity.issues)),
    '',
    '## Pull requests opened',
    ...renderSection(activity.pullRequests.length, formatPullRequestLine, sortByOccurredAt(activity.pullRequests)),
    '',
    '## PR reviews submitted',
    ...renderSection(activity.reviews.length, formatReviewLine, sortByOccurredAt(activity.reviews)),
    '',
    '## Commits on default branch',
    ...renderCommitSection(activity.commits),
    '',
  ];

  return lines.join('\n');
}

function buildSummary(activity: FilteredActivity): string[] {
  const totalCommits = activity.commits.reduce((acc, entry) => acc + entry.contributions.totalCount, 0);
  const issueRepos = countDistinctRepos(activity.issues);
  const prRepos = countDistinctRepos(activity.pullRequests);
  const reviewRepos = countDistinctRepos(activity.reviews);
  const commitRepos = activity.commits.length;
  return [
    `- ${activity.issues.length} issues opened across ${issueRepos} repos`,
    `- ${activity.pullRequests.length} PRs opened across ${prRepos} repos`,
    `- ${activity.reviews.length} PR reviews submitted across ${reviewRepos} repos`,
    `- ${totalCommits} commits on default branches across ${commitRepos} repos`,
  ];
}

function renderSection<T>(count: number, formatter: (item: T) => string, items: T[]): string[] {
  if (items.length === 0) {
    return ['_None._'];
  }
  const heading = `(${count})`;
  return [heading, ...items.map(formatter)];
}

function renderCommitSection(commits: CommitContributionRepository[]): string[] {
  if (commits.length === 0) {
    return ['_None._'];
  }
  const total = commits.reduce((acc, entry) => acc + entry.contributions.totalCount, 0);
  return [`(${total})`, ...commits.map((entry) => `- ${entry.repository.nameWithOwner}: ${entry.contributions.totalCount}`)];
}

function sortByOccurredAt<T extends { occurredAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function formatIssueLine(contribution: IssueContribution): string {
  const { issue, repository } = contribution;
  return `- [${repository.nameWithOwner}#${issue.number} — ${issue.title}](${issue.url}) — ${issue.state}`;
}

function formatPullRequestLine(contribution: PullRequestContribution): string {
  const { pullRequest, repository } = contribution;
  const state = pullRequest.state ?? 'OPEN';
  return `- [${repository.nameWithOwner}#${pullRequest.number} — ${pullRequest.title}](${pullRequest.url}) — ${state}`;
}

function formatReviewLine(contribution: PullRequestReviewContribution): string {
  const { pullRequest, repository } = contribution;
  return `- [${repository.nameWithOwner}#${pullRequest.number} — ${pullRequest.title}](${pullRequest.url})`;
}

function countDistinctRepos<T extends { repository: { nameWithOwner: string } }>(items: T[]): number {
  return new Set(items.map((item) => item.repository.nameWithOwner)).size;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export interface Client {
  graphql: typeof graphql;
}

export async function fetchActivity(client: Client, login: string, range: DateRange): Promise<FilteredActivity> {
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

function unwrapConnection<T>(
  response: ActivityResponse,
  key: ConnectionKey,
): Page<T> {
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

export interface WriteOptions {
  outputDir: string;
  fileName: string;
}

export function writeReport(content: string, options: WriteOptions): string {
  const filePath = join(options.outputDir, options.fileName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function deriveReportFileName(from: Date): string {
  return `${formatIsoDate(from).slice(0, 7)}.md`;
}

export interface RunOptions {
  token: string;
  fromInput?: string;
  toInput?: string;
  outputDir?: string;
  now?: Date;
  client?: Client;
}

export async function run(options: RunOptions): Promise<{ filePath: string; login: string; range: DateRange }> {
  const client = options.client ?? {
    graphql: graphql.defaults({ headers: { authorization: `bearer ${options.token}` } }),
  };
  const range = resolveDateRange(options.fromInput ?? '', options.toInput ?? '', options.now);
  const login = await resolveViewer(client);
  const activity = await fetchActivity(client, login, range);
  const markdown = formatReport(activity, { login, from: range.from, to: range.to });
  const outputDir = options.outputDir ?? 'reports';
  const fileName = deriveReportFileName(range.from);
  const filePath = writeReport(markdown, { outputDir, fileName });
  return { filePath, login, range };
}

async function main(): Promise<void> {
  const token = core.getInput('token') || process.env.GITHUB_TOKEN || process.env.REPORTER_TOKEN || '';
  if (!token) {
    throw new Error('Missing token: provide inputs.token, GITHUB_TOKEN, or REPORTER_TOKEN.');
  }
  const fromInput = core.getInput('from');
  const toInput = core.getInput('to');
  const result = await run({ token, fromInput, toInput });
  core.setOutput('report-path', result.filePath);
  core.setOutput('login', result.login);
  core.info(`Wrote report to ${result.filePath} for @${result.login}`);
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(message);
    process.exitCode = 1;
  });
}