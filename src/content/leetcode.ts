import { fetchQuestionDetails, normalizeSubmissionPayload } from '../lib/leetcode-api';
import type { SubmissionData } from '../lib/types';

interface RecentSubmission { id: number | string; status_display?: string; lang?: string; runtime?: string; memory?: string; }
interface SubmissionDetail { code?: string; runtime?: string; runtime_percentile?: number; memory?: string; memory_percentile?: number; }

let processing = false;
let lastSubmissionId: string | null = null;

function problemSlug(): string | null {
  return window.location.pathname.match(/^\/problems\/([^/]+)/)?.[1] ?? null;
}

function hasAcceptedResult(node: Node): boolean {
  return node.textContent?.trim() === 'Accepted' || Boolean(node.parentElement?.querySelector('[data-e2e-locator="submission-result"]')) && node.parentElement?.textContent?.includes('Accepted') === true;
}

async function latestAcceptedSubmission(slug: string): Promise<RecentSubmission | null> {
  const response = await fetch(`/api/submissions/?offset=0&limit=10&slug=${encodeURIComponent(slug)}`);
  if (!response.ok) throw new Error(`Could not read LeetCode submissions (HTTP ${response.status}).`);
  const data = await response.json() as { submissions_dump?: RecentSubmission[] };
  return data.submissions_dump?.find((submission) => submission.status_display === 'Accepted') ?? null;
}

async function submissionPayload(slug: string): Promise<SubmissionData | null> {
  const recent = await latestAcceptedSubmission(slug);
  if (!recent || String(recent.id) === lastSubmissionId) return null;
  const [question, detailResponse] = await Promise.all([
    fetchQuestionDetails(slug),
    fetch(`/submissions/detail/${encodeURIComponent(String(recent.id))}/`)
  ]);
  if (!detailResponse.ok) throw new Error(`Could not read accepted submission details (HTTP ${detailResponse.status}).`);
  const detail = await detailResponse.json() as SubmissionDetail;
  const payload = normalizeSubmissionPayload({
    statusDisplay: 'Accepted', questionId: question.questionId, questionTitle: question.title, titleSlug: question.titleSlug,
    difficulty: question.difficulty, code: detail.code, lang: recent.lang, runtime: Number(detail.runtime ?? recent.runtime ?? 0),
    runtimePercentile: detail.runtime_percentile, memory: Number(detail.memory ?? recent.memory ?? 0), memoryPercentile: detail.memory_percentile,
    topicTags: question.topicTags, submissionId: String(recent.id), timestamp: new Date().toISOString()
  });
  if (payload) lastSubmissionId = payload.submissionId;
  return payload;
}

async function pushLatestAcceptedSubmission(): Promise<void> {
  if (processing) return;
  const slug = problemSlug();
  if (!slug) return;
  processing = true;
  try {
    const submission = await submissionPayload(slug);
    if (!submission) return;
    const result = await chrome.runtime.sendMessage({ type: 'SUBMISSION_ACCEPTED', payload: submission }) as { success?: boolean; error?: string };
    if (!result?.success) console.error('LeetSync: sync failed:', result?.error ?? 'unknown error');
  } catch (error) {
    console.error('LeetSync: could not collect accepted submission:', error);
  } finally {
    window.setTimeout(() => { processing = false; }, 3000);
  }
}

if (problemSlug()) {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes].some(hasAcceptedResult))) void pushLatestAcceptedSubmission();
  });
  window.addEventListener('load', () => observer.observe(document.body, { childList: true, subtree: true, characterData: true }));
}
