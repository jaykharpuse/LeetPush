document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const form = document.getElementById('settingsForm');
  const tokenInput = document.getElementById('githubToken');
  const usernameInput = document.getElementById('githubUsername');
  const repoInput = document.getElementById('githubRepo');
  const folderInput = document.getElementById('repoFolder');
  const branchInput = document.getElementById('githubBranch');
  const diffToggle = document.getElementById('useDifficultyFolder');
  const langToggle = document.getElementById('useLanguageFolder');
  const commitFormatInput = document.getElementById('commitMessageFormat');
  const saveBtn = document.getElementById('saveButton');
  const togglePasswordBtn = document.getElementById('togglePassword');
  const eyeIcon = document.getElementById('eyeIcon');
  const toastContainer = document.getElementById('toastContainer');

  // SVG for eye open and closed
  const EYE_OPEN = `<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>`;
  const EYE_CLOSED = `<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.82l2.92 2.92c1.51-1.26 2.7-2.89 3.44-4.74-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>`;

  // Load configuration
  chrome.storage.sync.get({
    githubToken: '',
    githubUsername: '',
    githubRepo: '',
    repoFolder: 'LeetCode',
    githubBranch: 'main',
    useDifficultyFolder: true,
    useLanguageFolder: false,
    commitMessageFormat: 'Solved {problemId}. {problemName} [{difficulty}] - {language} | {time}% time, {space}% space'
  }, (items) => {
    tokenInput.value = items.githubToken;
    usernameInput.value = items.githubUsername;
    repoInput.value = items.githubRepo;
    folderInput.value = items.repoFolder;
    branchInput.value = items.githubBranch;
    diffToggle.checked = items.useDifficultyFolder;
    langToggle.checked = items.useLanguageFolder;
    commitFormatInput.value = items.commitMessageFormat;
  });

  // Toggle PAT visibility
  togglePasswordBtn.addEventListener('click', () => {
    const type = tokenInput.getAttribute('type') === 'password' ? 'text' : 'password';
    tokenInput.setAttribute('type', type);
    eyeIcon.innerHTML = type === 'password' ? EYE_OPEN : EYE_CLOSED;
  });

  // Save configuration
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const githubToken = tokenInput.value.trim();
    const githubUsername = usernameInput.value.trim();
    const githubRepo = repoInput.value.trim();
    const repoFolder = folderInput.value.trim() || 'LeetCode';
    const githubBranch = branchInput.value.trim() || 'main';
    const useDifficultyFolder = diffToggle.checked;
    const useLanguageFolder = langToggle.checked;
    const commitMessageFormat = commitFormatInput.value.trim();

    if (!githubToken || !githubUsername || !githubRepo) {
      showToast('❌ GitHub Token, Username, and Repo Name are required.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.innerText = 'Saving...';

    // Store in sync storage
    chrome.storage.sync.set({
      githubToken,
      githubUsername,
      githubRepo,
      repoFolder,
      githubBranch,
      useDifficultyFolder,
      useLanguageFolder,
      commitMessageFormat
    }, () => {
      saveBtn.disabled = false;
      saveBtn.innerText = 'Save Configuration';

      // Test connection check to GitHub API (Optional but good UX)
      checkGitHubConnection(githubUsername, githubRepo, githubToken)
        .then(isValid => {
          if (isValid) {
            showToast('✅ Configuration saved & verified successfully!', 'success');
          } else {
            showToast('⚠️ Saved, but GitHub connection check failed. Double check your settings.', 'error');
          }
        })
        .catch(() => {
          showToast('⚠️ Saved, but unable to verify connection. (Network error)', 'error');
        });
    });
  });

  // Toast helper
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = type === 'success' ? '✅' : '❌';
    
    const text = document.createElement('span');
    text.innerText = message;

    toast.appendChild(icon);
    toast.appendChild(text);
    toastContainer.appendChild(toast);

    // Trigger animation frame
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    // Remove after 3.5 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3500);
  }

  // Verify connection helper
  async function checkGitHubConnection(username, repo, token) {
    try {
      const response = await fetch(`https://api.github.com/repos/${username}/${repo}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
          'cache-control': 'no-cache'
        }
      });
      return response.status === 200;
    } catch (e) {
      return false;
    }
  }
});
