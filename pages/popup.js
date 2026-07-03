document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const repoValue = document.getElementById('repoValue');
  const lastPushSection = document.getElementById('lastPushSection');
  const lastPushName = document.getElementById('lastPushName');
  const lastPushTime = document.getElementById('lastPushTime');
  const settingsBtn = document.getElementById('settingsBtn');

  // Load sync configuration
  chrome.storage.sync.get({
    githubToken: '',
    githubUsername: '',
    githubOwner: '',
    githubRepo: ''
  }, (items) => {
    const isConfigured = items.githubToken && items.githubUsername && items.githubRepo;

    if (isConfigured) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      repoValue.replaceChildren();

      const repoLink = document.createElement('a');
      const repoOwner = items.githubOwner || items.githubUsername;
      repoLink.href = `https://github.com/${encodeURIComponent(repoOwner)}/${encodeURIComponent(items.githubRepo)}`;
      repoLink.target = '_blank';
      repoLink.rel = 'noopener noreferrer';
      repoLink.textContent = `${repoOwner}/${items.githubRepo}`;
      repoValue.appendChild(repoLink);
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Disconnected';
      repoValue.replaceChildren();

      const configLink = document.createElement('a');
      configLink.href = '#';
      configLink.textContent = 'Not configured (click to setup)';
      configLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      repoValue.appendChild(configLink);
    }
  });

  // Load last pushed problem details
  chrome.storage.local.get({
    lastPushProblemName: '',
    lastPushTimestamp: 0
  }, (items) => {
    if (items.lastPushProblemName && items.lastPushTimestamp) {
      lastPushSection.style.display = 'flex';
      lastPushName.textContent = items.lastPushProblemName;
      lastPushTime.textContent = formatRelativeTime(items.lastPushTimestamp);
    } else {
      lastPushSection.style.display = 'none';
    }
  });

  // Open settings
  settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Helper to format timestamp as relative time (e.g. "3 minutes ago")
  function formatRelativeTime(timestamp) {
    const now = Date.now();
    const diffMs = now - timestamp;
    
    if (diffMs < 60000) {
      return 'Just now';
    }
    
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) {
      return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    }
    
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) {
      return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    }
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  }
});
