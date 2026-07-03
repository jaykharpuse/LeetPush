import { normalizeSubmissionPayload } from '../lib/leetcode-api';
import type { SubmissionData } from '../lib/types';

const TARGET_URLS = ['https://leetcode.com/', 'https://leetcode.cn/'];
let lastSubmittedId: string | null = null;

function isLeetCodePage(): boolean {
  return TARGET_URLS.some((prefix) => window.location.href.startsWith(prefix));
}

function collectSubmissionFromDom(): SubmissionData | null {
  const scriptNodes = Array.from(document.querySelectorAll('script'));
  const text = scriptNodes.map((node) => node.textContent ?? '').join('\n');
  const payload = JSON.parse(text.match(/\"submissionDetails\"[^\{]*\{[^]*?\}\s*\}/)?.[0] ?? '{}');
  return normalizeSubmissionPayload(payload);
}

function sendSubmission(submission: SubmissionData): void {
  chrome.runtime.sendMessage({ type: 'SUBMISSION_ACCEPTED', payload: submission });
}

function detectAcceptedSubmission(): void {
  if (!isLeetCodePage()) {
    return;
  }

  const submission = collectSubmissionFromDom();
  if (!submission) {
    return;
  }

  if (lastSubmittedId === submission.submissionId) {
    return;
  }

  lastSubmittedId = submission.submissionId;
  sendSubmission(submission);
}

if (isLeetCodePage()) {
  window.addEventListener('load', () => {
    detectAcceptedSubmission();
    const observer = new MutationObserver(() => detectAcceptedSubmission());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
}
