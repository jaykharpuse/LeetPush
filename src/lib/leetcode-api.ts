import type { LeetCodeQuestionDetail, SubmissionData } from './types';

interface RawSubmissionLike {
  questionId?: string;
  questionTitle?: string;
  titleSlug?: string;
  difficulty?: string;
  code?: string;
  lang?: string;
  langSlug?: string;
  runtime?: number;
  runtimePercentile?: number;
  memory?: number;
  memoryPercentile?: number;
  topicTags?: Array<{ name?: string } | string>;
  submissionId?: string;
  timestamp?: string;
  statusDisplay?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeDifficulty(value: unknown): 'Easy' | 'Medium' | 'Hard' {
  if (value === 'Easy' || value === 'Medium' || value === 'Hard') {
    return value;
  }
  return 'Medium';
}

function normalizeLanguageExtension(lang: string): string {
  const mapping: Record<string, string> = {
    cpp: 'cpp',
    c: 'c',
    java: 'java',
    python: 'py',
    python3: 'py',
    golang: 'go',
    go: 'go',
    csharp: 'cs',
    javascript: 'js',
    typescript: 'ts',
    php: 'php',
    swift: 'swift',
    kotlin: 'kt',
    dart: 'dart',
    ruby: 'rb',
    scala: 'scala',
    rust: 'rs',
    racket: 'rkt',
    erlang: 'erl',
    elixir: 'ex',
    mysql: 'sql',
    mssql: 'sql',
    oracle: 'sql',
    pandas: 'py',
    postgresql: 'sql'
  };

  return (mapping[lang.toLowerCase()] ?? lang.toLowerCase()) || 'txt';
}

function findAcceptedSubmission(payload: unknown): RawSubmissionLike | null {
  if (!isRecord(payload)) {
    return null;
  }

  if (payload.statusDisplay === 'Accepted' && (payload.questionId || payload.questionTitle || payload.titleSlug || payload.code)) {
    return payload as RawSubmissionLike;
  }

  for (const value of Object.values(payload)) {
    const nested = findAcceptedSubmission(value);
    if (nested) {
      return nested;
    }
  }

  return null;
}

export function normalizeSubmissionPayload(data: unknown): SubmissionData | null {
  const submission = findAcceptedSubmission(data);
  if (!submission) {
    return null;
  }

  const questionId = String(submission.questionId ?? '').trim();
  const questionTitle = String(submission.questionTitle ?? '').trim();
  const titleSlug = String(submission.titleSlug ?? '').trim();
  const code = String(submission.code ?? '').trim();
  const lang = String(submission.lang ?? 'text').trim();
  if (!questionId || !questionTitle || !titleSlug || !code) {
    return null;
  }

  return {
    questionId,
    questionTitle,
    titleSlug,
    difficulty: normalizeDifficulty(submission.difficulty),
    code,
    lang,
    langExtension: submission.langSlug || normalizeLanguageExtension(lang),
    runtime: Number(submission.runtime ?? 0),
    runtimePercentile: Number(submission.runtimePercentile ?? 0),
    memory: Number(submission.memory ?? 0),
    memoryPercentile: Number(submission.memoryPercentile ?? 0),
    topicTags: Array.isArray(submission.topicTags)
      ? submission.topicTags
          .map((tag) => typeof tag === 'string' ? tag : tag?.name)
          .filter((tag): tag is string => Boolean(tag))
      : [],
    submissionId: String(submission.submissionId ?? `submission-${Date.now()}`),
    timestamp: submission.timestamp ?? new Date().toISOString()
  };
}

export async function fetchQuestionDetails(titleSlug: string): Promise<LeetCodeQuestionDetail> {
  const endpoints = ['https://leetcode.com/graphql', 'https://leetcode.cn/graphql'];
  const query = `query questionContent($titleSlug: String!) { question(titleSlug: $titleSlug) { questionId title titleSlug difficulty content topicTags { name } } }`;

  let lastError: Error | undefined;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ query, variables: { titleSlug } })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { errors?: Array<{ message?: string }>; data?: { question?: LeetCodeQuestionDetail } };
      if (payload.errors?.length) {
        throw new Error(payload.errors[0].message ?? 'GraphQL request failed');
      }

      if (payload.data?.question) {
        return payload.data.question;
      }
    } catch (error) {
      lastError = error as Error;
    }
  }

  throw lastError ?? new Error('Unable to fetch LeetCode problem details');
}
