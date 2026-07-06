import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { addDays, format } from 'date-fns';
import type { FilteredActivity } from './activity.ts';
import type { CommitContributionRepository, IssueContribution, PullRequestContribution, PullRequestReviewContribution } from './query.ts';

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
  return format(date, 'MMMM yyyy');
}

function formatIsoDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
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

export function deriveReportFileName(from: Date): string {
  return `${formatIsoDate(from).slice(0, 7)}.md`;
}