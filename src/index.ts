import * as core from '@actions/core';
import { graphql } from '@octokit/graphql';
import { fetchActivity, resolveViewer, type Client } from './activity.ts';
import { resolveDateRange, type DateRange } from './dates.ts';
import { deriveReportFileName, formatReport, writeReport } from './report.ts';

export type { DateRange } from './dates.ts';
export type { Client, FilteredActivity, Page, FetchPage } from './activity.ts';
export { paginate, filterPublic, fetchActivity, resolveViewer } from './activity.ts';
export { previousMonthRange, resolveDateRange } from './dates.ts';
export { formatReport, writeReport, deriveReportFileName, type ReportMeta, type WriteOptions } from './report.ts';

export interface RunOptions {
  token: string;
  fromInput?: string;
  toInput?: string;
  outputDir?: string;
  now?: Date;
  client?: Client;
}

export async function run(options: RunOptions): Promise<{ filePath: string; login: string; range: DateRange }> {
  const client =
    options.client ??
    ({
      graphql: graphql.defaults({ headers: { authorization: `bearer ${options.token}` } }),
    } satisfies Client);
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