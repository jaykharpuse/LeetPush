// Shared GitHub authentication and repository helpers for extension pages.
// Replace this value with the OAuth App's Client ID before distributing LeetPush.
const LEETPUSH_GITHUB_CLIENT_ID = 'REPLACE_WITH_YOUR_GITHUB_CLIENT_ID';

window.LeetPushGitHub = (() => {
  const API_ROOT = 'https://api.github.com';
  const DEVICE_CODE_URL = 'https://github.com/login/device/code';
  const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

  class GitHubError extends Error {
    constructor(message, status = 0, code = '') {
      super(message);
      this.name = 'GitHubError';
      this.status = status;
      this.code = code;
    }
  }

  async function request(path, { token, method = 'GET', body } = {}) {
    const response = await fetch(`${API_ROOT}${path}`, {
      method,
      headers: {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const data = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      throw new GitHubError(data?.message || `GitHub request failed (${response.status})`, response.status);
    }
    return data;
  }

  async function beginDeviceFlow() {
    if (!LEETPUSH_GITHUB_CLIENT_ID || LEETPUSH_GITHUB_CLIENT_ID.startsWith('REPLACE_')) {
      throw new GitHubError('GitHub OAuth Client ID is not configured. Follow the OAuth App setup steps in README.md.', 0, 'client_id_missing');
    }

    const response = await fetch(DEVICE_CODE_URL, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: LEETPUSH_GITHUB_CLIENT_ID,
        scope: 'repo'
      })
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new GitHubError(data.error_description || data.error || 'Unable to start GitHub authorization.', response.status, data.error);
    }
    return data;
  }

  function openDeviceAuthorization(deviceData) {
    const authUrl = `${deviceData.verification_uri}?user_code=${encodeURIComponent(deviceData.user_code)}`;
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, () => {
      // Device flow completes through polling. Closing GitHub's confirmation
      // window commonly sets runtime.lastError and is not an auth failure.
      void chrome.runtime.lastError;
    });
  }

  async function pollForAccessToken(deviceData, onProgress = () => {}) {
    let intervalSeconds = Math.max(Number(deviceData.interval) || 5, 5);
    const expiresAt = Date.now() + (Number(deviceData.expires_in) || 900) * 1000;

    while (Date.now() < expiresAt) {
      await delay(intervalSeconds * 1000);
      onProgress('Waiting for GitHub authorization…');

      const response = await fetch(ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          client_id: LEETPUSH_GITHUB_CLIENT_ID,
          device_code: deviceData.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });
      const data = await response.json();

      if (data.access_token) return data.access_token;
      if (data.error === 'authorization_pending') continue;
      if (data.error === 'slow_down') {
        intervalSeconds += 5;
        continue;
      }
      if (data.error === 'access_denied') {
        throw new GitHubError('GitHub authorization was cancelled.', response.status, data.error);
      }
      if (data.error === 'expired_token') {
        throw new GitHubError('The GitHub authorization code expired. Please try again.', response.status, data.error);
      }
      throw new GitHubError(data.error_description || data.error || 'GitHub authorization failed.', response.status, data.error);
    }

    throw new GitHubError('GitHub authorization timed out. Please try again.', 0, 'expired_token');
  }

  async function authorize(onCode, onProgress) {
    const deviceData = await beginDeviceFlow();
    onCode?.(deviceData.user_code);
    openDeviceAuthorization(deviceData);
    const token = await pollForAccessToken(deviceData, onProgress);
    return connectToken(token, 'oauth');
  }

  async function connectToken(token, authMethod = 'pat') {
    let user;
    try {
      user = await request('/user', { token });
    } catch (error) {
      if (error.status === 401) throw new GitHubError('Token invalid or expired', 401, 'invalid_token');
      throw error;
    }

    await storageSet({
      githubToken: token,
      githubUsername: user.login,
      githubAvatarUrl: user.avatar_url || '',
      githubAuthMethod: authMethod
    });
    return user;
  }

  async function fetchRepos(token) {
    return request('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', { token });
  }

  async function createRepo(token, name, isPrivate = true) {
    const trimmedName = name.trim();
    if (!trimmedName) throw new GitHubError('Enter a repository name first.', 0, 'repo_name_missing');

    return request('/user/repos', {
      token,
      method: 'POST',
      body: {
        name: trimmedName,
        private: isPrivate,
        auto_init: true,
        description: 'LeetCode solutions automatically pushed by LeetPush'
      }
    });
  }

  async function checkAndInitializeRepo(token, owner, repoName, onStatus = () => {}) {
    let repository;
    try {
      repository = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, { token });
    } catch (error) {
      if (error.status === 401) throw new GitHubError('Token invalid or expired', 401, 'invalid_token');
      if (error.status === 404) throw new GitHubError('Repository not found', 404, 'repo_not_found');
      throw error;
    }

    const branch = repository.default_branch || 'main';
    try {
      await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/git/ref/heads/${encodeURIComponent(branch)}`, { token });
    } catch (error) {
      if (error.status !== 404 && error.status !== 409) throw error;
      onStatus('Repository exists but is empty — initializing it now…');
      await initializeRepo(token, owner, repoName);
      repository = await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`, { token });
    }

    return repository;
  }

  async function initializeRepo(token, owner, repoName) {
    try {
      await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/contents/README.md`, {
        token,
        method: 'PUT',
        body: {
          message: 'Initialize repository for LeetPush',
          content: btoa('# LeetCode Solutions\n\nManaged by LeetPush.\n')
        }
      });
    } catch (error) {
      // A concurrent initializer may have won the race.
      if (error.status !== 422) throw error;
    }
  }

  async function selectRepository(repository) {
    await storageSet({
      githubOwner: repository.owner.login,
      githubRepo: repository.name,
      githubBranch: repository.default_branch || 'main'
    });
  }

  function getStoredConnection() {
    return storageGet({
      githubToken: '',
      githubUsername: '',
      githubAvatarUrl: '',
      githubAuthMethod: '',
      githubOwner: '',
      githubRepo: '',
      githubBranch: 'main'
    });
  }

  function storageGet(defaults) {
    return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(values, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  return {
    authorize,
    checkAndInitializeRepo,
    connectToken,
    createRepo,
    fetchRepos,
    getRedirectUrl: () => chrome.identity.getRedirectURL('github'),
    getStoredConnection,
    selectRepository
  };
})();
