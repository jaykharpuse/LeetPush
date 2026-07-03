document.addEventListener('DOMContentLoaded', async () => {
  const github = window.LeetPushGitHub;
  const elements = {
    steps: [document.getElementById('step1'), document.getElementById('step2'), document.getElementById('step3')],
    dots: [document.getElementById('dot1'), document.getElementById('dot2'), document.getElementById('dot3')],
    connect: document.getElementById('connectButton'),
    deviceCode: document.getElementById('deviceCode'),
    authStatus: document.getElementById('authStatus'),
    avatar: document.getElementById('avatar'),
    username: document.getElementById('username'),
    repoSearch: document.getElementById('repoSearch'),
    repoMenu: document.getElementById('repoMenu'),
    newRepoName: document.getElementById('newRepoName'),
    create: document.getElementById('createButton'),
    privateRepo: document.getElementById('privateRepo'),
    repoStatus: document.getElementById('repoStatus'),
    leetcode: document.getElementById('leetcodeButton')
  };

  let connection = await github.getStoredConnection();
  let repos = [];

  if (connection.githubToken && connection.githubUsername) {
    showAccount(connection.githubUsername, connection.githubAvatarUrl);
    await loadRepos();
    goToStep(2);
  }

  elements.connect.addEventListener('click', async () => {
    setLoading(elements.connect, true, 'Connecting…');
    setStatus(elements.authStatus, 'Starting secure GitHub authorization…');
    try {
      const user = await github.authorize(
        code => {
          elements.deviceCode.textContent = `Enter ${code} on GitHub, authorize, then close the window`;
          elements.deviceCode.classList.remove('hidden');
        },
        status => setStatus(elements.authStatus, status)
      );
      connection = await github.getStoredConnection();
      showAccount(user.login, user.avatar_url);
      await loadRepos();
      goToStep(2);
    } catch (error) {
      setStatus(elements.authStatus, error.message, true);
    } finally {
      elements.deviceCode.classList.add('hidden');
      setLoading(elements.connect, false);
    }
  });

  elements.repoSearch.addEventListener('focus', renderRepoMenu);
  elements.repoSearch.addEventListener('input', renderRepoMenu);
  document.addEventListener('click', event => {
    if (!event.target.closest('.combo')) elements.repoMenu.classList.add('hidden');
  });

  elements.create.addEventListener('click', async () => {
    setLoading(elements.create, true, 'Creating…');
    setStatus(elements.repoStatus, 'Creating and initializing repository…');
    try {
      const repository = await github.createRepo(connection.githubToken, elements.newRepoName.value, elements.privateRepo.checked);
      await finishRepository(repository);
    } catch (error) {
      setStatus(elements.repoStatus, friendlyError(error), true);
    } finally {
      setLoading(elements.create, false);
    }
  });

  elements.leetcode.addEventListener('click', () => chrome.tabs.create({ url: 'https://leetcode.com/problemset/' }));

  async function loadRepos() {
    setStatus(elements.repoStatus, 'Loading repositories…');
    try {
      repos = await github.fetchRepos(connection.githubToken);
      setStatus(elements.repoStatus, repos.length ? `${repos.length} repositories available` : 'No repositories yet — create one below.');
    } catch (error) {
      setStatus(elements.repoStatus, friendlyError(error), true);
    }
  }

  function renderRepoMenu() {
    const query = elements.repoSearch.value.trim().toLowerCase();
    const matches = repos.filter(repo => repo.full_name.toLowerCase().includes(query)).slice(0, 50);
    elements.repoMenu.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'status';
      empty.textContent = 'No matching repositories';
      elements.repoMenu.appendChild(empty);
    } else {
      for (const repo of matches) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'option';
        const name = document.createElement('strong');
        name.textContent = repo.full_name;
        const meta = document.createElement('span');
        meta.textContent = `${repo.private ? 'Private' : 'Public'} · ${repo.default_branch || 'main'}`;
        option.append(name, meta);
        option.addEventListener('click', () => finishRepository(repo));
        elements.repoMenu.appendChild(option);
      }
    }
    elements.repoMenu.classList.remove('hidden');
  }

  async function finishRepository(repo) {
    elements.repoMenu.classList.add('hidden');
    elements.repoSearch.value = repo.full_name;
    setStatus(elements.repoStatus, 'Checking repository…');
    try {
      const readyRepo = await github.checkAndInitializeRepo(
        connection.githubToken,
        repo.owner.login,
        repo.name,
        status => setStatus(elements.repoStatus, status)
      );
      await github.selectRepository(readyRepo);
      setStatus(elements.repoStatus, `${readyRepo.full_name} is ready.`);
      setTimeout(() => goToStep(3), 350);
    } catch (error) {
      setStatus(elements.repoStatus, friendlyError(error), true);
    }
  }

  function showAccount(username, avatarUrl) {
    elements.username.textContent = username;
    elements.avatar.src = avatarUrl;
    elements.avatar.alt = `${username}'s GitHub avatar`;
  }

  function goToStep(number) {
    elements.steps.forEach((step, index) => step.classList.toggle('hidden', index !== number - 1));
    elements.dots.forEach((dot, index) => {
      dot.classList.toggle('active', index === number - 1);
      dot.classList.toggle('done', index < number - 1);
      if (index < number - 1) dot.textContent = '✓';
    });
  }

  function setLoading(button, loading, label = '') {
    if (loading) {
      button.dataset.label = button.textContent;
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

  function setStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function friendlyError(error) {
    if (error.status === 401) return 'Token invalid or expired';
    if (error.status === 404) return 'Repository not found';
    return error.message || 'GitHub request failed.';
  }
});
