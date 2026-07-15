import { buildCommitMessage, renderReadmeContent } from './readme-generator';
import { loadStorage, saveLocalStorage } from './storage';
import type { GithubUserInfo, RepoConfig, SolvedProblem, SubmissionData, SyncResult, SyncStats, UserSettings } from './types';

interface GitHubApiError extends Error { status?: number; }
interface TreeEntry { path: string; type: string; sha: string; }
interface RepositoryTree { tree: TreeEntry[]; }

const API_ROOT = 'https://api.github.com';
const RETRY_LIMIT = 2;

function createApiError(message: string, status?: number): GitHubApiError {
  const error = new Error(message) as GitHubApiError;
  error.status = status;
  return error;
}

function repoPath(repo: RepoConfig): string {
  return `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function githubRequest(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  let lastNetworkError: unknown;
  for (let attempt = 0; attempt <= RETRY_LIMIT; attempt += 1) {
    try {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'application/vnd.github+json');
      headers.set('Authorization', `Bearer ${token}`);
      headers.set('X-GitHub-Api-Version', '2022-11-28');
      const response = await fetch(`${API_ROOT}${path}`, { ...init, headers });
      const rateLimited = response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0');
      if (!rateLimited || attempt === RETRY_LIMIT) return response;
      const retryAfter = Number(response.headers.get('retry-after'));
      await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * (attempt + 1));
    } catch (error) {
      lastNetworkError = error;
      if (attempt === RETRY_LIMIT) break;
      await wait(1000 * (attempt + 1));
    }
  }
  throw createApiError(`Network error while contacting GitHub. Your submission was saved for retry: ${lastNetworkError instanceof Error ? lastNetworkError.message : 'request failed'}`);
}

async function githubJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await githubRequest(path, token, init);
  const text = await response.text();
  if (!response.ok) {
    let message = text || 'GitHub request failed';
    try { message = (JSON.parse(text) as { message?: string }).message ?? message; } catch { /* response is not JSON */ }
    if (response.status === 401) message = 'GitHub authentication expired or is invalid. Please connect GitHub again.';
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') message = 'GitHub API rate limit reached. Please retry after it resets.';
    throw createApiError(message, response.status);
  }
  return text ? JSON.parse(text) as T : {} as T;
}

function encodeMetadata(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function decodeMetadata<T>(content: string, name: string, fallback: T): T {
  const match = content.match(new RegExp(`<!-- LEETSYNC_${name}:([A-Za-z0-9+/=]+) -->`));
  if (!match) return fallback;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch { return fallback; }
}

function markdownCell(value: string): string { return value.replace(/\|/g, '\\|').replace(/\n/g, ' '); }

function statsFromProblems(problems: SolvedProblem[]): SyncStats {
  const stats: SyncStats = { total: problems.length, easy: 0, medium: 0, hard: 0, languages: {} };
  for (const problem of problems) {
    if (problem.difficulty === 'Easy') stats.easy += 1;
    if (problem.difficulty === 'Medium') stats.medium += 1;
    if (problem.difficulty === 'Hard') stats.hard += 1;
    stats.languages![problem.language] = (stats.languages![problem.language] ?? 0) + 1;
  }
  return stats;
}

function renderStats(problems: SolvedProblem[]): string {
  const stats = statsFromProblems(problems);
  const languages = Object.entries(stats.languages ?? {}).sort(([first], [second]) => first.localeCompare(second));
  const rows = [...problems].sort((first, second) => Number(first.questionId) - Number(second.questionId)).map((problem) =>
    `| ${markdownCell(problem.title)} | ${problem.difficulty} | ${markdownCell(problem.language)} | ${problem.solvedAt} | [Open](${problem.folderPath}/) |`
  );
  return [
    '# LeetSync Statistics', '',
    `- Total solved: **${stats.total}**`,
    `- Easy: **${stats.easy}** · Medium: **${stats.medium}** · Hard: **${stats.hard}**`,
    `- Languages: ${languages.length ? languages.map(([language, count]) => `${language} (${count})`).join(', ') : 'None'}`,
    '', '## Problems', '',
    '| Problem Name | Difficulty | Language | Date Solved | Solution |',
    '|---|---|---|---|---|', ...rows, '',
    `<!-- LEETSYNC_STATS:${encodeMetadata(problems)} -->`, ''
  ].join('\n');
}

function renderTopics(problems: SolvedProblem[]): string {
  const topics = new Map<string, SolvedProblem[]>();
  for (const problem of problems) for (const topic of problem.topicTags) {
    const entries = topics.get(topic) ?? [];
    entries.push(problem); topics.set(topic, entries);
  }
  const sections = [...topics.entries()].sort(([first], [second]) => first.localeCompare(second)).flatMap(([topic, entries]) => [
    `## ${topic}`, '', ...entries.sort((first, second) => Number(first.questionId) - Number(second.questionId)).map((problem) =>
      `- [${problem.questionId}. ${problem.title}](${problem.folderPath}/) — ${problem.difficulty}, ${problem.language}`), ''
  ]);
  return ['# LeetSync Topic Index', '', 'Problems grouped using their LeetCode topic tags.', '', ...sections, `<!-- LEETSYNC_TOPICS:${encodeMetadata(problems)} -->`, ''].join('\n');
}

async function getBlobContent(repo: RepoConfig, token: string, entry: TreeEntry | undefined): Promise<string> {
  if (!entry || entry.type !== 'blob') return '';
  const blob = await githubJson<{ content?: string; encoding?: string }>(`${repoPath(repo)}/git/blobs/${entry.sha}`, token);
  if (!blob.content) return '';
  return blob.encoding === 'base64' ? new TextDecoder().decode(Uint8Array.from(atob(blob.content.replace(/\n/g, '')), (character) => character.charCodeAt(0))) : blob.content;
}

function isBetterSubmission(submission: SubmissionData, existingReadme: string): boolean {
  const runtime = Number(existingReadme.match(/- Runtime: ([\d.]+)/)?.[1]);
  const memory = Number(existingReadme.match(/- Memory: ([\d.]+)/)?.[1]);
  const language = existingReadme.match(/- Language: (.+)/)?.[1]?.trim();
  return language !== submission.lang || (Number.isFinite(runtime) && submission.runtime < runtime) || (Number.isFinite(memory) && submission.memory < memory);
}

export async function getGitHubUser(token: string): Promise<GithubUserInfo> {
  const data = await githubJson<{ login: string; avatar_url: string; name: string }>('/user', token);
  return { login: data.login, avatarUrl: data.avatar_url, name: data.name || data.login };
}

export async function ensureRepository(token: string, repoName: string): Promise<RepoConfig> {
  const user = await getGitHubUser(token);
  try {
    const repo = await githubJson<{ name: string; html_url: string; default_branch?: string }>(`/repos/${encodeURIComponent(user.login)}/${encodeURIComponent(repoName)}`, token);
    return { owner: user.login, name: repo.name, url: repo.html_url, defaultBranch: repo.default_branch || 'main' };
  } catch (error) {
    if ((error as GitHubApiError).status !== 404) throw error;
    const repo = await githubJson<{ name: string; html_url: string; default_branch?: string }>('/user/repos', token, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: repoName, private: true, description: 'My LeetCode solutions synced by LeetSync' })
    });
    return { owner: user.login, name: repo.name, url: repo.html_url, defaultBranch: repo.default_branch || 'main' };
  }
}

export async function pushSubmissionToGitHub(submission: SubmissionData, settings: UserSettings): Promise<SyncResult> {
  const data = await loadStorage();
  if (!data.accessToken) throw createApiError('GitHub authentication is missing. Please connect GitHub again.');
  const token = data.accessToken;
  const repo = data.repo ?? await ensureRepository(token, 'leetcode-solutions');
  await saveLocalStorage({ repo });
  const branch = repo.defaultBranch || 'main';
  const questionSlug = `${submission.questionId}-${submission.titleSlug}`;
  const folderPath = buildPath('leetcode-solutions', settings, submission, '');
  const codePath = `${folderPath}/${questionSlug}.${submission.langExtension || 'txt'}`;
  const readmePath = `${folderPath}/README.md`;

  let refSha: string | undefined;
  let baseTreeSha: string | undefined;
  try {
    refSha = (await githubJson<{ object: { sha: string } }>(`${repoPath(repo)}/git/ref/heads/${encodeURIComponent(branch)}`, token)).object.sha;
    baseTreeSha = (await githubJson<{ tree: { sha: string } }>(`${repoPath(repo)}/git/commits/${refSha}`, token)).tree.sha;
  } catch (error) {
    if ((error as GitHubApiError).status !== 404) throw error;
  }

  if (!baseTreeSha) {
    const emptyTree = await githubJson<{ sha: string }>(`${repoPath(repo)}/git/trees`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tree: [] }) });
    baseTreeSha = emptyTree.sha;
  }

  const tree = refSha ? await githubJson<RepositoryTree>(`${repoPath(repo)}/git/trees/${baseTreeSha}?recursive=1`, token) : { tree: [] };
  const existingReadme = await getBlobContent(repo, token, tree.tree.find((entry) => entry.path === readmePath));
  const existingCode = await getBlobContent(repo, token, tree.tree.find((entry) => entry.path === codePath));
  const statsContent = await getBlobContent(repo, token, tree.tree.find((entry) => entry.path === 'STATS.md'));
  const knownProblems = decodeMetadata<SolvedProblem[]>(statsContent, 'STATS', []);
  const existingProblem = knownProblems.find((problem) => problem.questionId === submission.questionId);
  const stats = statsFromProblems(knownProblems);

  if (existingReadme && (existingCode === submission.code || !isBetterSubmission(submission, existingReadme))) {
    return { repo, status: 'skipped', reason: existingCode === submission.code ? 'the same solution is already stored' : 'the existing submission has equal or better performance', stats };
  }

  const currentProblem: SolvedProblem = { questionId: submission.questionId, title: submission.questionTitle, titleSlug: submission.titleSlug, difficulty: submission.difficulty, language: submission.lang, solvedAt: new Date(submission.timestamp).toISOString().slice(0, 10), folderPath, topicTags: submission.topicTags };
  const problems = [...knownProblems.filter((problem) => problem.questionId !== submission.questionId), currentProblem];
  const nextStats = statsFromProblems(problems);
  const blobs = await Promise.all([submission.code, renderReadmeContent(submission), renderStats(problems), renderTopics(problems)].map((content) =>
    githubJson<{ sha: string }>(`${repoPath(repo)}/git/blobs`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, encoding: 'utf-8' }) })
  ));
  const newTree = await githubJson<{ sha: string }>(`${repoPath(repo)}/git/trees`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: [
      { path: codePath, mode: '100644', type: 'blob', sha: blobs[0].sha },
      { path: readmePath, mode: '100644', type: 'blob', sha: blobs[1].sha },
      { path: 'STATS.md', mode: '100644', type: 'blob', sha: blobs[2].sha },
      { path: 'TOPICS.md', mode: '100644', type: 'blob', sha: blobs[3].sha }
    ] })
  });
  const action = existingProblem ? 'Update' : 'Solved';
  const commit = await githubJson<{ sha: string }>(`${repoPath(repo)}/git/commits`, token, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: existingProblem ? `Update: ${submission.questionId}. ${submission.questionTitle}` : buildCommitMessage(settings.commitMessageTemplate, submission), tree: newTree.sha, parents: refSha ? [refSha] : [] })
  });
  if (refSha) {
    await githubJson(`${repoPath(repo)}/git/refs/heads/${encodeURIComponent(branch)}`, token, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: false }) });
  } else {
    await githubJson(`${repoPath(repo)}/git/refs`, token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }) });
  }
  console.info(`LeetSync: ${action.toLowerCase()} ${submission.questionTitle} in ${commit.sha}`);
  return { repo, status: existingProblem ? 'updated' : 'created', commitSha: commit.sha, stats: nextStats };
}

function buildPath(repoFolder: string, settings: UserSettings, submission: SubmissionData, fileName: string): string {
  const parts = [repoFolder];
  if (settings.useLanguageFolder) parts.push(submission.langExtension || 'other');
  if (settings.useDifficultyFolder) parts.push(submission.difficulty.toLowerCase());
  parts.push(`${submission.questionId}-${submission.titleSlug}`);
  return fileName ? `${parts.join('/')}/${fileName}` : parts.join('/');
}
