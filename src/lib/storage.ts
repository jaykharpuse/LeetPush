import type { DeviceFlowState, StorageData, UserSettings } from './types';

export async function loadStorage(): Promise<StorageData> {
  const [localData, syncData] = await Promise.all([
    chrome.storage.local.get(null),
    chrome.storage.sync.get(null)
  ]);

  return {
    ...(localData as StorageData),
    settings: (syncData.settings as UserSettings | undefined) ?? undefined
  };
}

export async function saveLocalStorage(values: Partial<StorageData>): Promise<void> {
  await chrome.storage.local.set(values);
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await chrome.storage.sync.set({ settings });
}

export async function setPendingAuth(state: DeviceFlowState): Promise<void> {
  await saveLocalStorage({ pendingAuth: state });
}

export async function clearAuthData(): Promise<void> {
  await chrome.storage.local.remove(['accessToken', 'githubUser', 'repo', 'stats', 'lastSynced', 'pendingAuth', 'manualAccessToken']);
}

export async function getAccessToken(): Promise<string | undefined> {
  const data = await loadStorage();
  return data.accessToken;
}
