document.addEventListener('DOMContentLoaded', async () => {
  const github = window.LeetPushGitHub;
  const elements = {
    authorize: document.getElementById('authorizeButton'),
    disconnected: document.getElementById('disconnectedState'),
    connected: document.getElementById('connectedState'),
    avatar: document.getElementById('avatar'),
    username: document.getElementById('connectedUsername'),
    deviceCode: document.getElementById('deviceCode'),
    repoSection: document.getElementById('repoSection'),
    repoSkeleton: document.getElementById('repoSkeleton'),
    repoControls: document.getElementById('repoControls'),
    repoSearch: document.getElementById('repoSearch'),
    repoMenu: document.getElementById('repoMenu'),
    selectedRepo: document.getElementById('selectedRepo'),
    refreshRepos: document.getElementById('refreshRepos'),
    createRepo: document.getElementById('createRepo'),
    newRepoName: document.getElementById('newRepoName'),
    privateRepo: document.getElementById('privateRepo'),
    token: document.getElementById('githubToken'),
    connectPat: document.getElementById('connectPat'),
    form: document.getElementById('settingsForm'),
    save: document.getElementById('saveButton'),
    folder: document.getElementById('repoFolder'),
    branch: document.getElementById('githubBranch'),
    difficulty: document.getElementById('useDifficultyFolder'),
    language: document.getElementById('useLanguageFolder'),
    commit: document.getElementById('commitMessageFormat'),
    toasts: document.getElementById('toastContainer')
  };

  let connection = await github.getStoredConnection();
  let repos = [];
  let selectedRepository = null;

  await loadPreferences();
  renderConnection();
  if (connection.githubToken) await loadRepos();

  elements.authorize.addEventListener('click', async () => {
    setButtonLoading(elements.authorize, true, 'Connecting…');
    elements.deviceCode.classList.add('hidden');
    try {
      const user = await github.authorize(
        code => {
          elements.deviceCode.textContent = `Enter ${code} on GitHub, authorize, then close the window`;
          elements.deviceCode.classList.remove('hidden');
        },
        status => setButtonLoading(elements.authorize, true, status)
      );
      connection = await github.getStoredConnection();
      renderConnection(user);
      showToast('GitHub connected', `Signed in as ${user.login}.`, 'success');
      await loadRepos();
    } catch (error) {
      showToast('Could not connect GitHub', error.message, 'error');
    } finally {
      elements.deviceCode.classList.add('hidden');
      setButtonLoading(elements.authorize, false);
      renderConnection();
    }
  });

  elements.connectPat.addEventListener('click', async () => {
    const token = elements.token.value.trim();
    if (!token) return showToast('PAT required', 'Paste a Personal Access Token first.', 'error');
    setButtonLoading(elements.connectPat, true, 'Checking…');
    try {
      const user = await github.connectToken(token, 'pat');
      connection = await github.getStoredConnection();
      renderConnection(user);
      showToast('PAT connected', `Signed in as ${user.login}.`, 'success');
      await loadRepos();
    } catch (error) {
      showToast('Connection failed', normalizeError(error), 'error');
    } finally {
      setButtonLoading(elements.connectPat, false);
    }
  });

  elements.refreshRepos.addEventListener('click', loadRepos);
  elements.repoSearch.addEventListener('focus', () => renderRepoMenu(elements.repoSearch.value));
  elements.repoSearch.addEventListener('input', () => renderRepoMenu(elements.repoSearch.value));
  document.addEventListener('click', event => {
    if (!event.target.closest('.combo')) elements.repoMenu.classList.add('hidden');
  });

  elements.createRepo.addEventListener('click', async () => {
    if (!connection.githubToken) return showToast('Connect GitHub first', 'Authorization is required before creating a repository.', 'error');
    setButtonLoading(elements.createRepo, true, 'Creating…');
    try {
      const repository = await github.createRepo(connection.githubToken, elements.newRepoName.value, elements.privateRepo.checked);
      repos.unshift(repository);
      await chooseRepository(repository);
      showToast('Repository created', `${repository.full_name} is initialized and ready.`, 'success');
    } catch (error) {
      showToast('Could not create repository', normalizeError(error), 'error');
    } finally {
      setButtonLoading(elements.createRepo, false);
    }
  });

  elements.form.addEventListener('submit', async event => {
    event.preventDefault();
    setButtonLoading(elements.save, true, 'Saving…');
    try {
      await storageSet({
        repoFolder: elements.folder.value.trim() || 'LeetCode',
        githubBranch: elements.branch.value.trim() || 'main',
        useDifficultyFolder: elements.difficulty.checked,
        useLanguageFolder: elements.language.checked,
        commitMessageFormat: elements.commit.value.trim() || 'Solved {problemId}. {problemName} [{difficulty}] - {language}'
      });

      if (connection.githubToken && connection.githubRepo) {
        const owner = connection.githubOwner || connection.githubUsername;
        const repository = await github.checkAndInitializeRepo(
          connection.githubToken,
          owner,
          connection.githubRepo,
          status => showToast('Preparing repository', status, 'success')
        );
        await github.selectRepository(repository);
        connection = await github.getStoredConnection();
        elements.branch.value = connection.githubBranch;
      }
      showToast('Preferences saved', 'LeetPush is ready for your next accepted solution.', 'success');
    } catch (error) {
      showToast('Could not save', normalizeError(error), 'error');
    } finally {
      setButtonLoading(elements.save, false);
    }
  });

  async function loadPreferences() {
    const values = await storageGet({
      repoFolder: 'LeetCode',
      githubBranch: 'main',
      useDifficultyFolder: true,
      useLanguageFolder: false,
      commitMessageFormat: 'Solved {problemId}. {problemName} [{difficulty}] - {language} | {time}% time, {space}% space'
    });
    elements.folder.value = values.repoFolder;
    elements.branch.value = values.githubBranch;
    elements.difficulty.checked = values.useDifficultyFolder;
    elements.language.checked = values.useLanguageFolder;
    elements.commit.value = values.commitMessageFormat;
  }

  function renderConnection(user = null) {
    const username = user?.login || connection.githubUsername;
    const avatarUrl = user?.avatar_url || connection.githubAvatarUrl;
    const connected = Boolean(connection.githubToken && username);
    elements.connected.classList.toggle('hidden', !connected);
    elements.disconnected.classList.toggle('hidden', connected);
    elements.repoSection.classList.toggle('hidden', !connected);
    elements.authorize.textContent = connected ? 'Reconnect GitHub' : 'Authorize with GitHub';
    if (connected) {
      elements.username.textContent = username;
      elements.avatar.src = avatarUrl;
      elements.avatar.alt = `${username}'s GitHub avatar`;
    }
  }

  async function loadRepos() {
    if (!connection.githubToken) return;
    elements.repoSkeleton.classList.remove('hidden');
    elements.repoControls.classList.add('hidden');
    setButtonLoading(elements.refreshRepos, true, 'Loading…');
    try {
      repos = await github.fetchRepos(connection.githubToken);
      const savedOwner = connection.githubOwner || connection.githubUsername;
      selectedRepository = repos.find(repo => repo.name === connection.githubRepo && repo.owner.login === savedOwner) || null;
      renderSelectedRepo();
      renderRepoMenu('');
    } catch (error) {
      showToast('Could not load repositories', normalizeError(error), 'error');
    } finally {
      elements.repoSkeleton.classList.add('hidden');
      elements.repoControls.classList.remove('hidden');
      setButtonLoading(elements.refreshRepos, false);
    }
  }

  function renderRepoMenu(query) {
    const normalized = query.trim().toLowerCase();
    const matches = repos.filter(repo => repo.full_name.toLowerCase().includes(normalized)).slice(0, 50);
    elements.repoMenu.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'No matching repositories';
      elements.repoMenu.appendChild(empty);
    } else {
      for (const repo of matches) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `repo-option${selectedRepository?.id === repo.id ? ' active' : ''}`;
        const name = document.createElement('strong');
        name.textContent = repo.full_name;
        const meta = document.createElement('span');
        meta.textContent = `${repo.private ? 'Private' : 'Public'} · ${repo.default_branch || 'main'}`;
        button.append(name, meta);
        button.addEventListener('click', () => chooseRepository(repo));
        elements.repoMenu.appendChild(button);
      }
    }
    elements.repoMenu.classList.remove('hidden');
  }

  async function chooseRepository(repo) {
    elements.repoMenu.classList.add('hidden');
    elements.repoSearch.value = repo.full_name;
    elements.selectedRepo.textContent = 'Checking repository…';
    try {
      const readyRepo = await github.checkAndInitializeRepo(
        connection.githubToken,
        repo.owner.login,
        repo.name,
        status => { elements.selectedRepo.textContent = status; }
      );
      await github.selectRepository(readyRepo);
      connection = await github.getStoredConnection();
      selectedRepository = readyRepo;
      elements.branch.value = connection.githubBranch;
      renderSelectedRepo();
      showToast('Repository selected', `${readyRepo.full_name} is ready.`, 'success');
    } catch (error) {
      elements.selectedRepo.textContent = '';
      showToast('Repository unavailable', normalizeError(error), 'error');
    }
  }

  function renderSelectedRepo() {
    if (!selectedRepository) {
      elements.selectedRepo.textContent = connection.githubRepo ? `${connection.githubOwner || connection.githubUsername}/${connection.githubRepo}` : 'No repository selected yet.';
      return;
    }
    elements.repoSearch.value = selectedRepository.full_name;
    elements.selectedRepo.textContent = `Ready · ${selectedRepository.private ? 'Private' : 'Public'} · ${selectedRepository.default_branch}`;
  }

  function showToast(title, message, type) {
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    const copy = document.createElement('div');
    copy.className = 'toast-copy';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const detail = document.createElement('span');
    detail.textContent = message;
    copy.append(heading, detail);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.append(copy, close);
    elements.toasts.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  }

  function setButtonLoading(button, loading, label = '') {
    if (loading) {
      if (!button.dataset.label) button.dataset.label = button.textContent;
      button.replaceChildren();
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      button.append(spinner, document.createTextNode(label));
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
      delete button.dataset.label;
    }
  }

  function normalizeError(error) {
    if (error.status === 401) return 'Token invalid or expired';
    if (error.status === 404) return 'Repository not found';
    return error.message || 'An unexpected GitHub error occurred.';
  }

  function storageGet(defaults) {
    return new Promise(resolve => chrome.storage.sync.get(defaults, resolve));
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => chrome.storage.sync.set(values, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    }));
  }
});
