// LeetPush Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'LEETPUSH_SUBMIT') {
    handleSolutionSubmission(message.payload)
      .then((result) => {
        sendResponse(result);
      })
      .catch((err) => {
        console.error("LeetPush background error:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep the message channel open for async sendResponse
  }

  if (message.type === 'LEETPUSH_ERROR') {
    showNotification('error', `LeetPush Error`, message.error);
    return false;
  }
});

// Primary handler for committing solution data to GitHub
async function handleSolutionSubmission(payload) {
  // 1. Fetch settings from storage
  const settings = await getSettings();
  
  const token = settings.githubToken;
  const username = settings.githubUsername;
  const repo = settings.githubRepo;
  const branch = settings.githubBranch || 'main';
  const repoFolder = settings.repoFolder || 'LeetCode';
  const useDifficultyFolder = settings.useDifficultyFolder;
  const useLanguageFolder = settings.useLanguageFolder;
  const commitMessageFormat = settings.commitMessageFormat;

  if (!token || !username || !repo) {
    const errorMsg = "GitHub integration is not fully configured in LeetPush settings.";
    showNotification('error', 'Push Failed', errorMsg);
    throw new Error(errorMsg);
  }

  const {
    questionId,
    title,
    titleSlug,
    difficulty,
    contentMarkdown,
    topicTags,
    acceptanceRate,
    submissionId,
    code,
    language,
    extension,
    runtime,
    runtimePercentile,
    memory,
    memoryPercentile
  } = payload;

  // 2. Resolve target directories & path names
  const cleanLanguage = getCleanLanguage(language);
  let pathParts = [repoFolder];
  if (useLanguageFolder) {
    pathParts.push(cleanLanguage);
  }
  if (useDifficultyFolder) {
    pathParts.push(difficulty);
  }
  pathParts.push(`${questionId}-${titleSlug}`);
  
  const folderPath = pathParts.filter(Boolean).join('/');
  const codePath = `${folderPath}/${questionId}-${titleSlug}.${extension}`;
  const readmePath = `${folderPath}/README.md`;

  // 3. Construct README.md file
  const readmeContent = `# ${questionId}. ${title}

## Metadata
- **Difficulty:** ${difficulty}
- **Topics:** ${topicTags.length > 0 ? topicTags.join(', ') : 'None'}
- **Language:** ${cleanLanguage}
- **Runtime:** ${runtime} (${runtimePercentile ? runtimePercentile + '%' : 'N/A'} percentile)
- **Memory:** ${memory} (${memoryPercentile ? memoryPercentile + '%' : 'N/A'} percentile)
- **Acceptance Rate:** ${acceptanceRate || 'N/A'}

## Description
${contentMarkdown}

## Solution Notes
<!-- Write your notes here -->
`;

  // 4. Construct Commit Message
  const today = new Date().toISOString().split('T')[0];
  const commitMessage = commitMessageFormat
    .replace(/{problemId}/g, questionId)
    .replace(/{problemName}/g, title)
    .replace(/{difficulty}/g, difficulty)
    .replace(/{language}/g, cleanLanguage)
    .replace(/{time}/g, runtimePercentile || 'N/A')
    .replace(/{space}/g, memoryPercentile || 'N/A')
    .replace(/{date}/g, today);

  console.log(`LeetPush: Committing solution to ${username}/${repo} on branch ${branch}...`);

  try {
    // --- Step 1: GET latest commit SHA of the branch ---
    const refPath = `/git/refs/heads/${branch}`;
    const refData = await gitRequest('GET', username, repo, token, refPath);
    if (!refData || !refData.object || !refData.object.sha) {
      throw new Error(`Branch '${branch}' not found. Please initialize the repository with at least one commit.`);
    }
    const parentCommitSha = refData.object.sha;

    // --- Step 2: GET tree SHA for that commit ---
    const commitPath = `/git/commits/${parentCommitSha}`;
    const commitData = await gitRequest('GET', username, repo, token, commitPath);
    if (!commitData || !commitData.tree || !commitData.tree.sha) {
      throw new Error("Unable to retrieve parent tree reference.");
    }
    const parentTreeSha = commitData.tree.sha;

    // --- Step 3: POST blob for solution file ---
    const codeBlob = await gitRequest('POST', username, repo, token, '/git/blobs', {
      content: code,
      encoding: 'utf-8'
    });
    const codeBlobSha = codeBlob.sha;

    // --- Step 4: POST blob for README.md file ---
    const readmeBlob = await gitRequest('POST', username, repo, token, '/git/blobs', {
      content: readmeContent,
      encoding: 'utf-8'
    });
    const readmeBlobSha = readmeBlob.sha;

    // --- Step 5: POST new tree combining both blobs ---
    const newTree = await gitRequest('POST', username, repo, token, '/git/trees', {
      base_tree: parentTreeSha,
      tree: [
        {
          path: codePath,
          mode: '100644',
          type: 'blob',
          sha: codeBlobSha
        },
        {
          path: readmePath,
          mode: '100644',
          type: 'blob',
          sha: readmeBlobSha
        }
      ]
    });
    const newTreeSha = newTree.sha;

    // --- Step 6: POST create single commit ---
    const newCommit = await gitRequest('POST', username, repo, token, '/git/commits', {
      message: commitMessage,
      tree: newTreeSha,
      parents: [parentCommitSha]
    });
    const newCommitSha = newCommit.sha;

    // --- Step 7: PATCH update branch reference ---
    await gitRequest('PATCH', username, repo, token, refPath, {
      sha: newCommitSha,
      force: false
    });

    console.log(`LeetPush: Successfully created commit ${newCommitSha}`);

    // Update local storage to prevent duplicate pushes and track popup stats
    await new Promise((resolve) => {
      chrome.storage.local.set({
        lastSubmissionId: submissionId,
        lastPushProblemName: title,
        lastPushTimestamp: Date.now()
      }, resolve);
    });

    // Notify user of success
    showNotification('success', 'LeetPush: Solution Saved! ✅', `${title} pushed to ${username}/${repo}`);
    return { success: true };

  } catch (err) {
    showNotification('error', 'LeetPush: Push Failed ❌', err.message);
    throw err;
  }
}

// REST call helper to communicate with GitHub API
async function gitRequest(method, owner, repo, token, path, body = null) {
  const url = `https://api.github.com/repos/${owner}/${repo}${path}`;
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'cache-control': 'no-cache'
    }
  };
  
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    let errMsg = `GitHub API error: ${response.status} ${response.statusText}`;
    try {
      const errData = await response.json();
      if (errData && errData.message) {
        errMsg = `GitHub: ${errData.message}`;
      }
    } catch (e) {}
    throw new Error(errMsg);
  }

  return response.json();
}

// Get configurations from storage
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      githubToken: '',
      githubUsername: '',
      githubRepo: '',
      githubBranch: 'main',
      repoFolder: 'LeetCode',
      useDifficultyFolder: true,
      useLanguageFolder: false,
      commitMessageFormat: 'Solved {problemId}. {problemName} [{difficulty}] - {language} | {time}% time, {space}% space'
    }, resolve);
  });
}

// Trigger standard Chrome system notification
function showNotification(type, title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.svg',
    title: title,
    message: message,
    priority: 2
  });
}

// Helper to format raw language key to a nice directory folder name
function getCleanLanguage(lang) {
  if (!lang) return '';
  const mapping = {
    'cpp': 'C++',
    'csharp': 'C#',
    'python3': 'Python3',
    'python': 'Python',
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
    'golang': 'Go',
    'rust': 'Rust',
    'ruby': 'Ruby',
    'swift': 'Swift',
    'kotlin': 'Kotlin',
    'scala': 'Scala',
    'php': 'PHP',
    'dart': 'Dart',
    'mysql': 'MySQL',
    'mssql': 'MSSQL',
    'oraclesql': 'OracleSQL',
    'postgresql': 'PostgreSQL'
  };
  const lower = lang.toLowerCase();
  if (mapping[lower]) return mapping[lower];
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}
