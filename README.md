# 🚀 LeetPush

LeetPush is a high-performance, dark-themed Chrome Extension that automatically pushes your accepted LeetCode solutions to a GitHub repository in **a single commit** (unlike other tools that create separate commits for the code and the description README).

---

## ✨ Key Features

- **⚡ Single Commit Pushes**: Combines the solution file and its metadata `README.md` into **one atomic commit** using GitHub's low-level Git Tree API.
- **👁️ Silent & Automatic**: Listens for successful submissions on LeetCode problem pages and triggers pushes in the background.
- **🎨 Modern Dark Theme**: Features a sleek, responsive UI matching LeetCode's modern layout (designed with curated CSS tokens, micro-animations, and password toggles).
- **📂 Customizable Folder Structure**: Organize your repository layout using synced settings:
  - **Difficulty Subfolders** (`LeetCode/Easy/1-two-sum/...`)
  - **Language Subfolders** (`LeetCode/Python3/Easy/1-two-sum/...`)
  - **Flat layout** (`LeetCode/1-two-sum/...`)
- **✏️ Dynamic Commit Messages**: Fully customizable commit message templates with dynamic placeholders.
- **🛡️ Duplicate Prevention**: Tracks recent submission IDs in local storage to prevent redundant API commits.
- **🔐 GitHub OAuth Onboarding**: Connects through GitHub's backend-less Device Flow, discovers your account automatically, and lets you select or create a repository.
- **🧩 Zero Dependencies**: Pure Javascript execution utilizing Chrome's native APIs and DOM parsers.

---

## 🛠️ Folder Structure

```text
leetpush/
├── manifest.json         # Extension configuration (Manifest V3)
├── content.js            # Content script; monitors submissions & extracts problem details
├── background.js         # Service worker; processes Git Tree transactions & notifications
├── welcome.html          # First-install onboarding wizard
├── .gitignore            # Excludes editor files, local credentials, and OS metadata
├── icons/                # Extension badges
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── pages/                # Configuration and popup interfaces
    ├── options.html      # Full-page settings panel (Dark Mode)
    ├── options.js        # Form validation, synced storage, and GitHub connection check
    ├── github.js         # Shared OAuth Device Flow and repository helpers
    ├── welcome.js        # Onboarding wizard controller
    ├── popup.html        # Compact toolbar popup
    └── popup.js          # Connected status manager and relative time formatter
```

---

## ⚙️ How the "Single Commit" Logic Works

Standard extensions use the high-level `PUT /repos/{owner}/{repo}/contents/{path}` API. However, doing this for two files (the code file and `README.md`) forces GitHub to create **two sequential commits**.

LeetPush solves this with one atomic Git Database transaction:

1. **Get Branch Head Reference**: Fetch the latest commit SHA of your target branch (`GET /git/ref/heads/{branch}`).
2. **Fetch Commit Tree**: Grab the base tree SHA linked to that latest commit (`GET /git/commits/{commit_sha}`).
3. **Read Root Tracking Files**: Read the existing root `STATS.md` and topic-index `README.md`, or start them from scratch.
4. **Write Four Blobs**: Upload the solution, per-problem README, updated stats, and updated topic index (`POST /git/blobs`).
5. **Create Unified Tree**: Put all four blob SHAs into one tree while retaining the parent tree (`POST /git/trees`).
6. **Construct One Commit**: Create one commit pointing to that unified tree (`POST /git/commits`).
7. **Advance HEAD Once**: Update the branch reference to the new commit (`PATCH /git/refs/heads/{branch}`).

---

## 🚀 Installation & Setup

### One-time GitHub OAuth App setup

GitHub's normal web OAuth code exchange requires a Client Secret, which must never be bundled in a Chrome extension. LeetPush therefore uses GitHub's backend-less **Device Flow**: the extension ships only a Client ID and polls GitHub directly for the token. No proxy or hosted backend is required.

The GitHub verification page does not redirect to the extension in Device Flow. After approving access, close the GitHub authorization window; LeetPush's polling completes the connection automatically.

1. Load the unpacked extension once, copy its ID from `chrome://extensions`, and form this callback URL:
   `https://<YOUR_EXTENSION_ID>.chromiumapp.org/github`
2. Open GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**.
3. Use these values:
   - **Application name:** `LeetPush`
   - **Homepage URL:** your LeetPush project page (or `https://leetcode.com` for local development)
   - **Authorization callback URL:** the exact `https://<YOUR_EXTENSION_ID>.chromiumapp.org/github` URL from step 1
4. Create the app and enable **Device Flow** in the OAuth App settings.
5. Copy the displayed **Client ID** into `LEETPUSH_GITHUB_CLIENT_ID` at the top of `pages/github.js`.
6. GitHub may offer a **Client Secret**. Leave it stored only in GitHub; LeetPush does not need or embed it. If you replace Device Flow with the standard web authorization-code flow later, exchange the code on a trusted backend that holds this secret.

For a published extension, keep a stable extension ID and register its final callback URL before distribution.

### Load the Extension in Google Chrome
1. Clone or download this project folder to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the `LeetPush` folder directory.

### Configure LeetPush
1. On first install, the welcome wizard opens automatically.
2. Choose **Connect with GitHub**, approve the `repo` scope, then select an existing repository or create a private `leetcode-solutions` repository.
3. New or empty repositories are initialized automatically, so the first Git Tree commit has a valid branch.
4. Use **Open Settings** later to change repository, folder, or commit-message preferences.
5. A PAT remains available only as a fallback under **Advanced / Use a Personal Access Token instead**.

---

## 📝 Commit Message Placeholders

You can customize your commit message template in the settings page. The following variables will be dynamically populated upon submission:

| Variable | Description | Example Output |
| :--- | :--- | :--- |
| `{problemId}` | LeetCode problem ID | `1` |
| `{problemName}` | Problem Title | `Two Sum` |
| `{difficulty}` | Difficulty Level | `Easy` |
| `{language}` | Code Language (Formatted) | `Python3` |
| `{time}` | Runtime speed percentile | `94.2` |
| `{space}` | Memory consumption percentile | `81.5` |
| `{date}` | UTC Date of submission | `2026-06-21` |

*Default Format:*
`Solved {problemId}. {problemName} [{difficulty}] - {language} | {time}% time, {space}% space`

---

## 🔒 Security & Privacy

- **Extension Storage Only**: Your OAuth token or fallback PAT is stored in `chrome.storage.sync`; no LeetPush server receives it.
- **Direct API Calls**: The extension makes direct API calls to `api.github.com` and `leetcode.com`. No intermediate server receives or logs your tokens or code.
