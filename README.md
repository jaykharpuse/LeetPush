# LeetSync

LeetSync is a Manifest V3 Chrome extension that watches LeetCode problem pages for an accepted submission and syncs it to a GitHub repository.

## What it does

- Collects the most recent accepted submission from LeetCode and fetches question details through LeetCode GraphQL.
- Creates a solution file and a per-problem `README.md` in one GitHub Git Tree commit.
- Maintains `STATS.md` with total, difficulty, language, and per-problem statistics.
- Maintains `TOPICS.md`, grouping solved problems by their LeetCode topic tags.
- Avoids duplicate commits: identical code is skipped; an existing problem is updated only when the language differs or runtime/memory is better.
- Creates a private `leetcode-solutions` repository when none has been configured, including the first branch commit for an empty repository.
- Retries transient network failures and GitHub rate-limit responses. A failed non-auth submission is retained locally and can be retried from the popup.

The extension has no runtime UI framework or third-party runtime dependencies: it uses TypeScript, Vite 5, Chrome APIs, GitHub REST/Git Database APIs, and LeetCode GraphQL.

## Build and load

```bash
npm install
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select this project directory. Chrome reads `manifest.json`, which loads only the generated `dist/` scripts.

## Connect GitHub

Open the extension popup and use one of these methods:

1. **OAuth Device Flow:** enter your GitHub OAuth App Client ID, save it, select **Connect GitHub**, open the shown verification URL, and enter the device code. The OAuth app needs the `repo` scope and Device Flow enabled.
2. **Personal access token:** paste a token with repository access into the optional token field and select **Save Token**. The token is validated against GitHub before it is stored.

Tokens and configuration remain in Chrome extension storage; LeetSync does not use an intermediary server.

On first sync, LeetSync uses or creates the private `leetcode-solutions` repository under the authenticated account. The popup shows the local synchronized totals and most recently synced problem.

## Commit templates and folders

The default commit template is `Time: {runtime} ms ({runtimePercentile}%), Space: {memory} MB ({memoryPercentile}%) - LeetSync`.
Supported placeholders include `{questionId}`, `{questionTitle}`, `{difficulty}`, `{lang}`, `{language}`, `{runtime}`, `{runtimePercentile}`, `{memory}`, `{memoryPercentile}`, `{time}`, `{space}`, and `{date}`.

The sync code supports language and/or difficulty folders below `leetcode-solutions/<problem-id>-<slug>/` when those stored settings are enabled. The current popup does not yet expose a settings editor, so its default layout is flat.

## Manual test checklist

- [ ] Run `npm run build` and load the unpacked project in `chrome://extensions`.
- [ ] Connect with GitHub OAuth Device Flow and confirm the popup shows the account.
- [ ] Sign out, connect using a valid PAT, and confirm invalid tokens show an error.
- [ ] Submit an accepted solution into an empty target repository; confirm code, problem README, `STATS.md`, and `TOPICS.md` arrive in one commit.
- [ ] Submit a different problem into the initialized repository and confirm all stats totals update.
- [ ] Submit the same code again and confirm no GitHub commit is created; submit a measurably better or different-language solution and confirm an `Update:` commit is created.
- [ ] Confirm popup counts and Last synced match the generated `STATS.md` after successful sync.
- [ ] Sign out and confirm a later sync asks for GitHub authentication.
