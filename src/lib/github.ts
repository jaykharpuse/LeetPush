import { buildCommitMessage, renderReadmeContent } from './readme-generator';
import { getAccessToken, loadStorage, saveLocalStorage } from './storage';
import type { GithubUserInfo, RepoConfig, SubmissionData, UserSettings } from './types';

interface GitHubApiError extends Error {
  status?: number;
}

function createApiError(message: string, status?: number): GitHubApiError {
  const error = new Error(message) as GitHubApiError;
  error.status = status;
  return error;
}

async function githubRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/vnd.github+json');
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-GitHub-Api-Version', '2022-11-28');

  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers
  });
}

async function githubJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await githubRequest(path, token, init);
  const text = await response.text();
  if (!response.ok) {
    let message = 'GitHub request failed';
    try {
      const parsed = JSON.parse(text) as { message?: string };
      message = parsed.message ?? message;
    } catch {
      message = text || message;
    }
    throw createApiError(message, response.status);
  }

  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export async function getGitHubUser(token: string): Promise<GithubUserInfo> {
  const data = await githubJson<{ login: string; avatar_url: string; name: string }>('/user', token);
  return {
    login: data.login,
    avatarUrl: data.avatar_url,
    name: data.name || data.login
  };
}

export async function ensureRepository(token: string, repoName: string): Promise<RepoConfig> {
  const user = await getGitHubUser(token);
  const owner = user.login;

  try {
    const repo = await githubJson<{ name: string; html_url: string }>('/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repoName), token);
    return { owner, name: repo.name, url: repo.html_url };
  } catch (error) {
    const apiError = error as GitHubApiError;
    if (apiError.status !== 404) {
      throw error;
    }

    const createdRepo = await githubJson<{ name: string; html_url: string }>('/user/repos', token, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        private: true,
        description: 'My LeetCode solutions synced by LeetSync'
      })
    });

    return { owner, name: createdRepo.name, url: createdRepo.html_url };
  }
}

export async function pushSubmissionToGitHub(submission: SubmissionData, settings: UserSettings): Promise<{ repo: RepoConfig; commitSha: string; }> {
  const data = await loadStorage();
  const token = data.accessToken;
  if (!token) {
    throw createApiError('GitHub authentication is missing.');
  }

  const repo = data.repo ?? await ensureRepository(token, 'leetcode-solutions');
  await saveLocalStorage({ repo });

  const branch = 'main';
  const repoFolder = 'leetcode-solutions';
  const extension = submission.langExtension || 'txt';
  const questionSlug = `${submission.questionId}-${submission.titleSlug}`;
  const codePath = buildPath(repoFolder, settings, submission, `${questionSlug}.${extension}`);
  const readmePath = buildPath(repoFolder, settings, submission, 'README.md');
  const readmeContent = renderReadmeContent(submission);
  const commitMessage = buildCommitMessage(settings.commitMessageTemplate, submission);

  let refSha: string | undefined;
  let baseTreeSha: string | undefined;
  let initialCommitSha: string | undefined;

  try {
    const ref = await githubJson<{ object: { sha: string } }>(`/repos/${repo.owner}/${repo.name}/git/refs/heads/${branch}`, token);
    refSha = ref.object.sha;
  } catch (error) {
    const apiError = error as GitHubApiError;
    if (apiError.status !== 404) {
      throw error;
    }
  }

  if (refSha) {
    const commit = await githubJson<{ tree: { sha: string } }>(`/repos/${repo.owner}/${repo.name}/git/commits/${refSha}`, token);
    baseTreeSha = commit.tree.sha;
  } else {
    const emptyTree = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/trees', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tree: [] })
    });
    const initialReadmeBlob = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/blobs', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '# LeetSync\n\nAuto-synced LeetCode solutions.\n', encoding: 'utf-8' })
    });
    const initialTree = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/trees', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        base_tree: emptyTree.sha,
        tree: [{ path: 'README.md', mode: '100644', type: 'blob', sha: initialReadmeBlob.sha }]
      })
    });
    const initialCommit = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/commits', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Initialize LeetSync repository',
        tree: initialTree.sha,
        parents: []
      })
    });
    initialCommitSha = initialCommit.sha;
    await githubRequest(`/repos/${repo.owner}/${repo.name}/git/refs/heads/${branch}`, token, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: initialCommit.sha, force: true })
    });
    baseTreeSha = initialTree.sha;
  }

  const codeBlob = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/blobs', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: submission.code, encoding: 'utf-8' })
  });
  const readmeBlob = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/blobs', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: readmeContent, encoding: 'utf-8' })
  });

  const newTree = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/trees', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [
        { path: codePath, mode: '100644', type: 'blob', sha: codeBlob.sha },
        { path: readmePath, mode: '100644', type: 'blob', sha: readmeBlob.sha }
      ]
    })
  });

  const newCommit = await githubJson<{ sha: string }>('/repos/' + encodeURIComponent(repo.owner) + '/' + encodeURIComponent(repo.name) + '/git/commits', token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: commitMessage,
      tree: newTree.sha,
      parents: refSha ? [refSha] : initialCommitSha ? [initialCommitSha] : []
    })
  });

  await githubRequest(`/repos/${repo.owner}/${repo.name}/git/refs/heads/${branch}`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha, force: false })
  });

  return { repo, commitSha: newCommit.sha };
}

function buildPath(repoFolder: string, settings: UserSettings, submission: SubmissionData, fileName: string): string {
  const parts = [repoFolder];
  if (settings.useLanguageFolder) {
    parts.push(submission.langExtension || 'other');
  }
  if (settings.useDifficultyFolder) {
    parts.push(submission.difficulty.toLowerCase());
  }
  parts.push(`${submission.questionId}-${submission.titleSlug}`);
  return `${parts.join('/')}/${fileName}`;
}

