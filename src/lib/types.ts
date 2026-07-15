export interface SubmissionData {
  questionId: string;
  questionTitle: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  code: string;
  lang: string;
  langExtension: string;
  runtime: number;
  runtimePercentile: number;
  memory: number;
  memoryPercentile: number;
  topicTags: string[];
  submissionId: string;
  timestamp: string;
  problemContent?: string;
}

export interface GithubUserInfo {
  login: string;
  avatarUrl: string;
  name: string;
}

export interface RepoConfig {
  owner: string;
  name: string;
  url?: string;
  defaultBranch?: string;
}

export interface UserSettings {
  commitMessageTemplate: string;
  useDifficultyFolder: boolean;
  useLanguageFolder: boolean;
}

export interface SyncStats {
  total: number;
  easy: number;
  medium: number;
  hard: number;
  languages?: Record<string, number>;
}

export interface SolvedProblem {
  questionId: string;
  title: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  language: string;
  solvedAt: string;
  folderPath: string;
  topicTags: string[];
}

export interface SyncResult {
  repo: RepoConfig;
  status: 'created' | 'updated' | 'skipped';
  reason?: string;
  commitSha?: string;
  stats: SyncStats;
}

export interface LastSyncedInfo {
  title: string;
  timestamp: string;
  slug: string;
}

export interface StorageData {
  accessToken?: string;
  githubUser?: GithubUserInfo;
  repo?: RepoConfig;
  stats?: SyncStats;
  lastSynced?: LastSyncedInfo;
  settings?: UserSettings;
  pendingAuth?: DeviceFlowState;
  githubClientId?: string;
  manualAccessToken?: string;
  pendingSubmission?: SubmissionData;
}

export interface DeviceFlowState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  createdAt: number;
}

export interface LeetCodeQuestionDetail {
  questionId: string;
  title: string;
  titleSlug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  content: string;
  topicTags: Array<{ name: string }>;
}

export interface PopupState {
  authenticated: boolean;
  githubUser?: GithubUserInfo;
  repo?: RepoConfig;
  settings: UserSettings;
  stats: SyncStats;
  lastSynced?: LastSyncedInfo;
  pendingAuth?: DeviceFlowState;
}

export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval: number;
  expires_in: number;
}

export interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
