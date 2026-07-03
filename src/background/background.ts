import { pushSubmissionToGitHub } from '../lib/github';
import { fetchQuestionDetails, normalizeSubmissionPayload } from '../lib/leetcode-api';
import { clearAuthData, loadStorage, saveLocalStorage, setPendingAuth } from '../lib/storage';
import type { DeviceFlowState, StorageData, SubmissionData, UserSettings } from '../lib/types';

const GITHUB_CLIENT_ID = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_GITHUB_CLIENT_ID ?? 'Iv1.9b1c61f3e1c2878b';

interface MessageEnvelope {
  type: string;
  payload?: unknown;
  error?: string;
}

const DEFAULT_SETTINGS: UserSettings = {
  commitMessageTemplate: 'Time: {runtime} ms ({runtimePercentile}%), Space: {memory} MB ({memoryPercentile}%) - LeetSync',
  useDifficultyFolder: false,
  useLanguageFolder: false
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message: MessageEnvelope, _sender, sendResponse) => {
  void (async () => {
    if (message.type === 'SUBMISSION_ACCEPTED') {
      const result = await handleSubmission(message.payload);
      sendResponse(result);
      return;
    }

    if (message.type === 'START_DEVICE_FLOW') {
      const result = await startDeviceFlow();
      sendResponse(result);
      return;
    }

    if (message.type === 'POLL_DEVICE_FLOW') {
      const result = await pollDeviceFlow();
      sendResponse(result);
      return;
    }

    if (message.type === 'SIGN_OUT') {
      await clearAuthData();
      sendResponse({ success: true });
      return;
    }

    if (message.type === 'GET_POPUP_STATE') {
      const state = await buildPopupState();
      sendResponse(state);
      return;
    }

    sendResponse({ success: false, error: 'Unsupported message' });
  })();

  return true;
});

async function handleSubmission(payload: unknown): Promise<{ success: boolean; error?: string; data?: SubmissionData }> {
  try {
    const parsed = normalizeSubmissionPayload(payload);
    if (!parsed) {
      throw new Error('Submission payload was incomplete.');
    }

    const storage = await loadStorage();
    const settings = storage.settings ?? DEFAULT_SETTINGS;
    if (!storage.accessToken) {
      throw new Error('GitHub authentication is not available.');
    }

    const questionDetails = await fetchQuestionDetails(parsed.titleSlug);
    const submissionData: SubmissionData = {
      ...parsed,
      questionTitle: questionDetails.title || parsed.questionTitle,
      titleSlug: questionDetails.titleSlug || parsed.titleSlug,
      difficulty: questionDetails.difficulty || parsed.difficulty,
      topicTags: questionDetails.topicTags.map((tag) => tag.name),
      problemContent: questionDetails.content
    };

    const result = await pushSubmissionToGitHub(submissionData, settings);
    await saveLocalStorage({
      stats: mergeStats(storage.stats, submissionData),
      lastSynced: { title: submissionData.questionTitle, timestamp: new Date().toISOString(), slug: submissionData.titleSlug }
    });

    await updateBadge('✓');
    return { success: true, data: submissionData };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await updateBadge('✗');
    return { success: false, error: message };
  }
}

async function startDeviceFlow(): Promise<{ success: true; state: DeviceFlowState } | { success: false; error: string }> {
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo'
      })
    });

    if (!response.ok) {
      throw new Error(`Device flow failed with ${response.status}`);
    }

    const payload = (await response.json()) as { device_code: string; user_code: string; verification_uri: string; interval: number; expires_in: number };
    const state: DeviceFlowState = {
      deviceCode: payload.device_code,
      userCode: payload.user_code,
      verificationUri: payload.verification_uri,
      interval: payload.interval || 5,
      expiresIn: payload.expires_in,
      createdAt: Date.now()
    };

    await setPendingAuth(state);
    return { success: true, state };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Device flow failed';
    return { success: false, error: message };
  }
}

async function pollDeviceFlow(): Promise<{ success: true; accessToken?: string } | { success: false; error: string }> {
  const storage = await loadStorage();
  const pendingAuth = storage.pendingAuth;
  if (!pendingAuth) {
    return { success: false, error: 'No pending auth flow.' };
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: pendingAuth.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    const payload = (await response.json()) as { access_token?: string; error?: string; error_description?: string };
    if (payload.access_token) {
      await saveLocalStorage({ accessToken: payload.access_token, pendingAuth: undefined });
      return { success: true, accessToken: payload.access_token };
    }

    if (payload.error === 'authorization_pending') {
      return { success: false, error: 'authorization_pending' };
    }

    return { success: false, error: payload.error_description ?? payload.error ?? 'Polling failed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Polling failed';
    return { success: false, error: message };
  }
}

async function buildPopupState(): Promise<StorageData & { authenticated: boolean }> {
  const storage = await loadStorage();
  const settings = storage.settings ?? DEFAULT_SETTINGS;
  return {
    ...storage,
    settings,
    authenticated: Boolean(storage.accessToken),
    stats: storage.stats ?? { total: 0, easy: 0, medium: 0, hard: 0 }
  };
}

function mergeStats(existing: StorageData['stats'] | undefined, submission: SubmissionData): StorageData['stats'] {
  const next = existing ?? { total: 0, easy: 0, medium: 0, hard: 0 };
  const difficultyCount = submission.difficulty.toLowerCase() as keyof typeof next;
  const safeCount = difficultyCount === 'easy' || difficultyCount === 'medium' || difficultyCount === 'hard' ? difficultyCount : 'total';
  const updated = { ...next, total: next.total + 1 };
  if (safeCount === 'easy') updated.easy += 1;
  if (safeCount === 'medium') updated.medium += 1;
  if (safeCount === 'hard') updated.hard += 1;
  return updated;
}

async function updateBadge(text: string): Promise<void> {
  await chrome.action.setBadgeText({ text });
  window.setTimeout(() => {
    void chrome.action.setBadgeText({ text: '' });
  }, 5000);
}
