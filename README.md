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
- **🧩 Zero Dependencies**: Pure Javascript execution utilizing Chrome's native APIs and DOM parsers.

---

## 🛠️ Folder Structure

```text
leetpush/
├── manifest.json         # Extension configuration (Manifest V3)
├── content.js            # Content script; monitors submissions & extracts problem details
├── background.js         # Service worker; processes Git Tree transactions & notifications
├── .gitignore            # Excludes editor files, local credentials, and OS metadata
├── icons/                # Extension badges
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── pages/                # Configuration and popup interfaces
    ├── options.html      # Full-page settings panel (Dark Mode)
    ├── options.js        # Form validation, synced storage, and GitHub connection check
    ├── popup.html        # Compact toolbar popup
    └── popup.js          # Connected status manager and relative time formatter
```

---

## ⚙️ How the "Single Commit" Logic Works

Standard extensions use the high-level `PUT /repos/{owner}/{repo}/contents/{path}` API. However, doing this for two files (the code file and `README.md`) forces GitHub to create **two sequential commits**.

LeetPush solves this by utilizing GitHub's **Git Database API** in 7 discrete steps:

1. **Get Branch Head Reference**: Fetch the latest commit SHA of your target branch (`GET /git/refs/heads/{branch}`).
2. **Fetch Commit Tree**: Grab the base tree SHA linked to that latest commit (`GET /git/commits/{commit_sha}`).
3. **Write Code Blob**: Upload the solution code as a raw git blob and get a blob SHA (`POST /git/blobs`).
4. **Write Markdown Blob**: Upload the compiled problem `README.md` as a raw git blob (`POST /git/blobs`).
5. **Create Unified Tree**: Post a new tree detailing both blobs at their exact target subfolder paths, using the parent tree SHA as the base so other repository files are not removed (`POST /git/trees`).
6. **Construct Commit**: Create a new commit object pointing to the unified tree SHA, setting the parent commit SHA as its parent (`POST /git/commits`).
7. **Advance HEAD Pointer**: Update the branch reference to point directly to the new commit (`PATCH /git/refs/heads/{branch}`).

---

## 🚀 Installation & Setup

### Prerequisites
1. A GitHub repository to store your solutions (ensure the repo has at least one file, like a `README.md` or `.gitignore`, so that the default branch is initialized).
2. A GitHub **Personal Access Token (PAT)**.
   - Go to [GitHub Developer Settings](https://github.com/settings/tokens).
   - Generate a new token (classic).
   - Select the `repo` scope (allows reading and writing code commits).

### Load the Extension in Google Chrome
1. Clone or download this project folder to your local machine.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click the **Load unpacked** button in the top-left corner.
5. Select the `LeetPush` folder directory.

### Configure the Settings
1. Click the **LeetPush** icon from your Chrome toolbar.
2. Select **Open Settings** to open the options dashboard.
3. Configure your details:
   - **GitHub Personal Access Token**: Input your generated PAT.
   - **GitHub Username**: Your GitHub handle.
   - **Repository Name**: The name of your target repository (e.g., `Leetcode-Solutions`).
   - **Toggles**: Toggle difficulty or language folders.
   - **Commit Message Format**: Adjust using the placeholder variables.
4. Click **Save Configuration**. A verification check will query the GitHub API to ensure your settings are correct and display a status toast.

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

- **Local Storage Only**: Your GitHub Personal Access Token is saved securely using Chrome's `chrome.storage.sync` and `chrome.storage.local` APIs.
- **Direct API Calls**: The extension makes direct API calls to `api.github.com` and `leetcode.com`. No intermediate server receives or logs your tokens or code.
