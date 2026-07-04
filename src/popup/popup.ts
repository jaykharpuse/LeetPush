import type { PopupState } from '../lib/types';

const authView = document.getElementById('auth-view') as HTMLElement | null;
const readyView = document.getElementById('ready-view') as HTMLElement | null;
const connectButton = document.getElementById('connect-button') as HTMLButtonElement | null;
const deviceCodeBox = document.getElementById('device-code-box') as HTMLDivElement | null;
const clientIdInput = document.getElementById('client-id-input') as HTMLInputElement | null;
const saveClientIdButton = document.getElementById('save-client-id-button') as HTMLButtonElement | null;
const tokenInput = document.getElementById('token-input') as HTMLInputElement | null;
const saveTokenButton = document.getElementById('save-token-button') as HTMLButtonElement | null;
const userName = document.getElementById('user-name') as HTMLElement | null;
const repoName = document.getElementById('repo-name') as HTMLElement | null;
const avatar = document.getElementById('avatar') as HTMLImageElement | null;
const totalSolved = document.getElementById('total-solved') as HTMLElement | null;
const easyCount = document.getElementById('easy-count') as HTMLElement | null;
const mediumCount = document.getElementById('medium-count') as HTMLElement | null;
const hardCount = document.getElementById('hard-count') as HTMLElement | null;
const lastSynced = document.getElementById('last-synced') as HTMLElement | null;
const signOutButton = document.getElementById('sign-out-button') as HTMLButtonElement | null;

async function loadState(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' });
  render(response as PopupState);
}

function render(state: PopupState): void {
  if (!authView || !readyView) {
    return;
  }

  if (clientIdInput) {
    clientIdInput.value = (state as PopupState & { githubClientId?: string }).githubClientId || '';
  }

  if (state.authenticated) {
    authView.classList.add('hidden');
    readyView.classList.remove('hidden');
    if (userName) userName.textContent = state.githubUser?.name || state.githubUser?.login || 'LeetSync';
    if (repoName) repoName.textContent = state.repo ? `${state.repo.name}` : 'No repository configured';
    if (avatar) avatar.src = state.githubUser?.avatarUrl || 'https://avatars.githubusercontent.com/u/0?v=4';
    if (totalSolved) totalSolved.textContent = String(state.stats?.total ?? 0);
    if (easyCount) easyCount.textContent = String(state.stats?.easy ?? 0);
    if (mediumCount) mediumCount.textContent = String(state.stats?.medium ?? 0);
    if (hardCount) hardCount.textContent = String(state.stats?.hard ?? 0);
    if (lastSynced) lastSynced.textContent = state.lastSynced ? `${state.lastSynced.title} • ${new Date(state.lastSynced.timestamp).toLocaleDateString()}` : 'None yet';
  } else {
    readyView.classList.add('hidden');
    authView.classList.remove('hidden');
    if (deviceCodeBox) {
      deviceCodeBox.classList.add('hidden');
    }
  }
}

connectButton?.addEventListener('click', async () => {
  if (!deviceCodeBox || !connectButton) {
    return;
  }
  connectButton.disabled = true;
  connectButton.textContent = 'Starting…';
  const response = await chrome.runtime.sendMessage({ type: 'START_DEVICE_FLOW' });
  if (response?.success && response.state) {
    deviceCodeBox.classList.remove('hidden');
    deviceCodeBox.innerHTML = `<strong>Open GitHub</strong><br />${response.state.verificationUri}<br /><strong>Code:</strong> ${response.state.userCode}`;
    let pollCount = 0;
    const poll = async () => {
      const next = await chrome.runtime.sendMessage({ type: 'POLL_DEVICE_FLOW' });
      if (next?.success) {
        connectButton.textContent = 'Connected';
        await loadState();
        return;
      }
      if (next?.error === 'authorization_pending' && pollCount < 20) {
        pollCount += 1;
        setTimeout(poll, 5000);
        return;
      }
      deviceCodeBox.innerHTML = `<strong>Authentication failed</strong><br />${next?.error ?? 'Unknown error'}`;
      connectButton.disabled = false;
      connectButton.textContent = 'Connect GitHub';
    };
    void poll();
  } else {
    deviceCodeBox.classList.remove('hidden');
    deviceCodeBox.textContent = response?.error ?? 'Unable to start device flow';
    connectButton.disabled = false;
    connectButton.textContent = 'Connect GitHub';
  }
});

saveClientIdButton?.addEventListener('click', async () => {
  if (!clientIdInput) {
    return;
  }
  await chrome.storage.local.set({ githubClientId: clientIdInput.value.trim() });
  await loadState();
});

saveTokenButton?.addEventListener('click', async () => {
  if (!tokenInput) {
    return;
  }
  const token = tokenInput.value.trim();
  if (!token) {
    return;
  }
  await chrome.storage.local.set({ manualAccessToken: token, accessToken: token, pendingAuth: undefined });
  await loadState();
});

signOutButton?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
  await loadState();
});

void loadState();
