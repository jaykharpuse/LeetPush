// LeetPush Background Service Worker

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

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
  const owner = settings.githubOwner || username;
  const repo = settings.githubRepo;
  let branch = settings.githubBranch || 'main';
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

  console.log(`LeetPush: Committing solution to ${owner}/${repo} on branch ${branch}...`);

  try {
    // --- Step 1: GET latest commit SHA of the branch ---
    const refPath = `/git/ref/heads/${branch}`;
    let refData;
    try {
      refData = await gitRequest('GET', owner, repo, token, refPath);
    } catch (error) {
      if (error.status !== 404 && error.status !== 409) throw error;
      branch = await initializeEmptyRepository(owner, repo, token, branch);
      refData = await gitRequest('GET', owner, repo, token, `/git/ref/heads/${branch}`);
    }
    if (!refData || !refData.object || !refData.object.sha) {
      throw new Error(`Branch '${branch}' not found. Please initialize the repository with at least one commit.`);
    }
    const parentCommitSha = refData.object.sha;

    // --- Step 2: GET tree SHA for that commit ---
    const commitPath = `/git/commits/${parentCommitSha}`;
    const commitData = await gitRequest('GET', owner, repo, token, commitPath);
    if (!commitData || !commitData.tree || !commitData.tree.sha) {
      throw new Error("Unable to retrieve parent tree reference.");
    }
    const parentTreeSha = commitData.tree.sha;

    // Read the current root-level stats and topic index from the parent tree.
    const rootTree = await gitRequest('GET', owner, repo, token, `/git/trees/${parentTreeSha}`);
    const [existingStatsContent, existingRootReadmeContent] = await Promise.all([
      readTreeBlob(rootTree, 'STATS.md', owner, repo, token),
      readTreeBlob(rootTree, 'README.md', owner, repo, token)
    ]);

    const existingTopicIndex = parseTopicIndex(existingRootReadmeContent);
    const wasAlreadySolved = topicIndexContainsProblem(existingTopicIndex, questionId);
    const statsContent = updateStatsContent(
      existingStatsContent,
      { questionId, difficulty, language: cleanLanguage, solvedDate: today },
      wasAlreadySolved
    );
    const rootReadmeContent = updateTopicIndexContent(existingRootReadmeContent, existingTopicIndex, {
      questionId,
      title,
      difficulty,
      topicTags,
      folderPath
    });

    // --- Steps 3-6: Create all four blobs before constructing one tree. ---
    const [codeBlob, readmeBlob, statsBlob, rootReadmeBlob] = await Promise.all([
      createBlob(owner, repo, token, code),
      createBlob(owner, repo, token, readmeContent),
      createBlob(owner, repo, token, statsContent),
      createBlob(owner, repo, token, rootReadmeContent)
    ]);

    // --- Step 7: POST one tree containing all four files. ---
    const newTree = await gitRequest('POST', owner, repo, token, '/git/trees', {
      base_tree: parentTreeSha,
      tree: [
        {
          path: codePath,
          mode: '100644',
          type: 'blob',
          sha: codeBlob.sha
        },
        {
          path: readmePath,
          mode: '100644',
          type: 'blob',
          sha: readmeBlob.sha
        },
        {
          path: 'STATS.md',
          mode: '100644',
          type: 'blob',
          sha: statsBlob.sha
        },
        {
          path: 'README.md',
          mode: '100644',
          type: 'blob',
          sha: rootReadmeBlob.sha
        }
      ]
    });
    const newTreeSha = newTree.sha;

    // --- Step 8: POST create single commit ---
    const newCommit = await gitRequest('POST', owner, repo, token, '/git/commits', {
      message: commitMessage,
      tree: newTreeSha,
      parents: [parentCommitSha]
    });
    const newCommitSha = newCommit.sha;

    // --- Step 9: PATCH update branch reference ---
    await gitRequest('PATCH', owner, repo, token, `/git/refs/heads/${branch}`, {
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
    showNotification('success', 'LeetPush: Solution Saved! ✅', `${title} pushed to ${owner}/${repo}`);
    return { success: true };

  } catch (err) {
    showNotification('error', 'LeetPush: Push Failed ❌', err.message);
    throw err;
  }
}

const STATS_METADATA_PATTERN = /<!-- LEETPUSH_STATS:([A-Za-z0-9+/=]+) -->/;
const TOPIC_INDEX_START = '<!-- LEETPUSH_TOPIC_INDEX_START -->';
const TOPIC_INDEX_END = '<!-- LEETPUSH_TOPIC_INDEX_END -->';
const TOPIC_INDEX_METADATA_PATTERN = /<!-- LEETPUSH_TOPIC_INDEX:([A-Za-z0-9+/=]+) -->/;

async function initializeEmptyRepository(owner, repo, token, requestedBranch) {
  const repository = await gitRequest('GET', owner, repo, token, '');
  const defaultBranch = repository.default_branch || requestedBranch || 'main';

  // A configured branch can become stale. Prefer an existing default branch
  // before treating the repository as empty.
  try {
    await gitRequest('GET', owner, repo, token, `/git/ref/heads/${defaultBranch}`);
    return defaultBranch;
  } catch (error) {
    if (error.status !== 404 && error.status !== 409) throw error;
  }

  try {
    await gitRequest('PUT', owner, repo, token, '/contents/README.md', {
      message: 'Initialize repository for LeetPush',
      content: btoa('# LeetCode Solutions\n\nManaged by LeetPush.\n')
    });
  } catch (error) {
    // If another request initialized it concurrently, the ref lookup below is authoritative.
    if (error.status !== 422) throw error;
  }

  return defaultBranch;
}

async function createBlob(owner, repo, token, content) {
  return gitRequest('POST', owner, repo, token, '/git/blobs', {
    content,
    encoding: 'utf-8'
  });
}

async function readTreeBlob(treeData, path, owner, repo, token) {
  const entry = treeData && Array.isArray(treeData.tree)
    ? treeData.tree.find(item => item.path === path && item.type === 'blob')
    : null;

  if (!entry) return '';

  const blob = await gitRequest('GET', owner, repo, token, `/git/blobs/${entry.sha}`);
  if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string') {
    throw new Error(`Unable to decode existing ${path}.`);
  }

  return decodeBase64Utf8(blob.content);
}

function updateStatsContent(existingContent, problem, wasAlreadySolved) {
  const stats = parseStats(existingContent);
  const problemKey = String(problem.questionId);
  const isNewProblem = !wasAlreadySolved && !stats.solvedProblems[problemKey];

  if (isNewProblem) {
    stats.solvedProblems[problemKey] = {
      difficulty: problem.difficulty,
      language: problem.language
    };
    stats.totalSolved += 1;
    stats.difficulty[problem.difficulty] = (stats.difficulty[problem.difficulty] || 0) + 1;
    stats.languages[problem.language] = (stats.languages[problem.language] || 0) + 1;
    stats.currentStreak = calculateStreak(stats.lastSolvedDate, stats.currentStreak, problem.solvedDate);
    stats.lastSolvedDate = problem.solvedDate;
  }

  return renderStats(stats);
}

function parseStats(content) {
  const defaults = {
    totalSolved: 0,
    difficulty: { Easy: 0, Medium: 0, Hard: 0 },
    languages: {},
    currentStreak: 0,
    lastSolvedDate: '',
    solvedProblems: {}
  };
  const metadataMatch = content.match(STATS_METADATA_PATTERN);

  if (metadataMatch) {
    try {
      const saved = JSON.parse(decodeBase64Utf8(metadataMatch[1]));
      return {
        ...defaults,
        ...saved,
        difficulty: { ...defaults.difficulty, ...(saved.difficulty || {}) },
        languages: saved.languages || {},
        solvedProblems: saved.solvedProblems || {}
      };
    } catch (error) {
      console.warn('LeetPush: Existing STATS.md metadata could not be parsed.', error);
    }
  }

  const totalMatch = content.match(/Total Problems Solved:\*\*\s*(\d+)/i);
  const streakMatch = content.match(/Current Streak:\*\*\s*(\d+)/i);
  const dateMatch = content.match(/Last Solved Date:\*\*\s*([^\n]+)/i);
  defaults.totalSolved = totalMatch ? Number(totalMatch[1]) : 0;
  defaults.currentStreak = streakMatch ? Number(streakMatch[1]) : 0;
  defaults.lastSolvedDate = dateMatch && dateMatch[1] !== 'N/A' ? dateMatch[1].trim() : '';

  for (const level of Object.keys(defaults.difficulty)) {
    const match = content.match(new RegExp(`\\|\\s*${level}\\s*\\|\\s*(\\d+)\\s*\\|`, 'i'));
    defaults.difficulty[level] = match ? Number(match[1]) : 0;
  }

  const languageSection = content.match(/## Languages\s*\n[\s\S]*?(?=\n## |$)/i);
  if (languageSection) {
    for (const match of languageSection[0].matchAll(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\|$/gm)) {
      const language = match[1].trim();
      if (language !== 'Language' && !language.startsWith('-')) {
        defaults.languages[language] = Number(match[2]);
      }
    }
  }

  return defaults;
}

function renderStats(stats) {
  const languageRows = Object.entries(stats.languages)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([language, count]) => `| ${language} | ${count} |`)
    .join('\n') || '| None | 0 |';
  const metadata = encodeBase64Utf8(JSON.stringify(stats));

  return `# LeetPush Statistics

**Total Problems Solved:** ${stats.totalSolved}
**Current Streak:** ${stats.currentStreak} day${stats.currentStreak === 1 ? '' : 's'}
**Last Solved Date:** ${stats.lastSolvedDate || 'N/A'}

## Difficulty

| Difficulty | Solved |
| --- | ---: |
| Easy | ${stats.difficulty.Easy || 0} |
| Medium | ${stats.difficulty.Medium || 0} |
| Hard | ${stats.difficulty.Hard || 0} |

## Languages

| Language | Solved |
| --- | ---: |
${languageRows}

<!-- LEETPUSH_STATS:${metadata} -->
`;
}

function calculateStreak(lastDate, currentStreak, solvedDate) {
  if (!lastDate) return 1;
  if (lastDate === solvedDate) return Math.max(currentStreak, 1);

  const dayInMs = 24 * 60 * 60 * 1000;
  const difference = Math.round((Date.parse(`${solvedDate}T00:00:00Z`) - Date.parse(`${lastDate}T00:00:00Z`)) / dayInMs);
  return difference === 1 ? Math.max(currentStreak, 1) + 1 : 1;
}

function parseTopicIndex(content) {
  const managedSection = getManagedTopicSection(content);
  const metadataMatch = managedSection.match(TOPIC_INDEX_METADATA_PATTERN);

  if (!metadataMatch) return {};

  try {
    return JSON.parse(decodeBase64Utf8(metadataMatch[1]));
  } catch (error) {
    console.warn('LeetPush: Existing topic index metadata could not be parsed.', error);
    return {};
  }
}

function topicIndexContainsProblem(index, questionId) {
  const problemKey = String(questionId);
  return Object.values(index).some(entries => Array.isArray(entries) && entries.some(entry => String(entry.questionId) === problemKey));
}

function updateTopicIndexContent(existingContent, index, problem) {
  const problemKey = String(problem.questionId);

  for (const topic of Object.keys(index)) {
    index[topic] = Array.isArray(index[topic])
      ? index[topic].filter(entry => String(entry.questionId) !== problemKey)
      : [];
    if (index[topic].length === 0) delete index[topic];
  }

  const topics = Array.isArray(problem.topicTags) && problem.topicTags.length > 0
    ? [...new Set(problem.topicTags)]
    : ['Uncategorized'];
  const entry = {
    questionId: problemKey,
    title: problem.title,
    difficulty: problem.difficulty,
    path: `${problem.folderPath}/`
  };

  for (const topic of topics) {
    if (!index[topic]) index[topic] = [];
    index[topic].push(entry);
    index[topic].sort((a, b) => Number(a.questionId) - Number(b.questionId));
  }

  const section = renderTopicIndex(index);
  const startIndex = existingContent.indexOf(TOPIC_INDEX_START);
  const endIndex = existingContent.indexOf(TOPIC_INDEX_END);

  if (startIndex !== -1 && endIndex > startIndex) {
    return `${existingContent.slice(0, startIndex)}${section}${existingContent.slice(endIndex + TOPIC_INDEX_END.length)}`;
  }

  const prefix = existingContent.trim() || '# LeetCode Solutions';
  return `${prefix}\n\n${section}\n`;
}

function getManagedTopicSection(content) {
  const startIndex = content.indexOf(TOPIC_INDEX_START);
  const endIndex = content.indexOf(TOPIC_INDEX_END);
  if (startIndex === -1 || endIndex <= startIndex) return '';
  return content.slice(startIndex, endIndex + TOPIC_INDEX_END.length);
}

function renderTopicIndex(index) {
  const sections = Object.keys(index)
    .sort((a, b) => a.localeCompare(b))
    .map(topic => {
      const entries = index[topic]
        .map(entry => `- [${escapeMarkdown(entry.questionId)}. ${escapeMarkdown(entry.title)}](${encodeURI(entry.path)}) — ${escapeMarkdown(entry.difficulty)}`)
        .join('\n');
      return `## ${escapeMarkdown(topic)}\n\n${entries}`;
    })
    .join('\n\n');
  const metadata = encodeBase64Utf8(JSON.stringify(index));

  return `${TOPIC_INDEX_START}
# Topic Index

${sections}

<!-- LEETPUSH_TOPIC_INDEX:${metadata} -->
${TOPIC_INDEX_END}`;
}

function escapeMarkdown(value) {
  return String(value).replace(/([\\[\]])/g, '\\$1');
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
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
    const error = new Error(errMsg);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Get configurations from storage
function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({
      githubToken: '',
      githubUsername: '',
      githubOwner: '',
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
