import type { SubmissionData } from './types';

function escapeMarkdown(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, '\n');
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function renderReadmeContent(submission: SubmissionData): string {
  const description = stripHtml(submission.problemContent ?? submission.questionTitle ?? '');
  const topics = submission.topicTags.length > 0 ? submission.topicTags.map((tag) => `- \`${tag}\``).join('\n') : '- None';
  return [
    `# ${submission.questionId}. ${submission.questionTitle}`,
    '',
    `- Difficulty: ${submission.difficulty}`,
    `- Language: ${submission.lang}`,
    `- Runtime: ${submission.runtime} ms`,
    `- Memory: ${submission.memory} MB`,
    '',
    '## Problem',
    '',
    description || 'Problem description unavailable.',
    '',
    '## Stats',
    '',
    '| Property | Value | Percentile |',
    '|----------|-------|------------|',
    `| Runtime | ${submission.runtime} ms | ${submission.runtimePercentile}% |`,
    `| Memory | ${submission.memory} MB | ${submission.memoryPercentile}% |`,
    '',
    '## Topics',
    '',
    topics,
    '',
    '## Submission Date',
    '',
    new Date(submission.timestamp).toLocaleString()
  ].join('\n');
}

export function buildCommitMessage(template: string, submission: SubmissionData): string {
  const values: Record<string, string> = {
    runtime: String(submission.runtime),
    runtimePercentile: String(submission.runtimePercentile),
    memory: String(submission.memory),
    memoryPercentile: String(submission.memoryPercentile),
    lang: submission.lang,
    difficulty: submission.difficulty,
    titleSlug: submission.titleSlug,
    questionId: submission.questionId,
    questionTitle: escapeMarkdown(submission.questionTitle)
  };

  const defaultTemplate = 'Time: {runtime} ms ({runtimePercentile}%), Space: {memory} MB ({memoryPercentile}%) - LeetSync';
  const resolvedTemplate = template.trim() || defaultTemplate;
  return resolvedTemplate.replace(/\{([^}]+)\}/g, (_match, key: string) => values[key] ?? '');
}
