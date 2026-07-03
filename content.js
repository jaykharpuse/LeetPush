// LeetPush Content Script

const LANG_MAP = {
  "cpp": "cpp",
  "c": "c",
  "java": "java",
  "python": "py",
  "python3": "py",
  "golang": "go",
  "go": "go",
  "csharp": "cs",
  "javascript": "js",
  "typescript": "ts",
  "rust": "rs",
  "ruby": "rb",
  "swift": "swift",
  "kotlin": "kt",
  "scala": "scala",
  "php": "php",
  "dart": "dart",
  "r": "r",
  "erlang": "erl",
  "elixir": "ex",
  "typescriptreact": "tsx",
  "javascriptreact": "jsx",
  "mysql": "sql",
  "mssql": "sql",
  "oraclesql": "sql",
  "postgresql": "sql"
};

let isProcessing = false;
let lastKnownSubmissionId = null;
let observedResultContainer = null;

// Watch only the active submission result UI for a newly-rendered Accepted state.
const observer = new MutationObserver((mutations) => {
  if (isProcessing) return;

  if (mutations.some(mutationContainsAcceptedResult)) {
    triggerPushSequence();
  }
});

initializeAcceptedDetection();

async function initializeAcceptedDetection() {
  const slug = getProblemSlug();
  const storedSubmissionId = await getLastSubmissionId();
  lastKnownSubmissionId = storedSubmissionId;

  if (slug) {
    const currentSubmission = await fetchRecentAcceptedSubmission(slug, 1);
    if (currentSubmission) lastKnownSubmissionId = Number(currentSubmission.id);
  }

  attachToSubmissionResultContainer();
  setInterval(attachToSubmissionResultContainer, 1000);
  console.log("LeetPush content script loaded and observing the submission result container.");
}

function attachToSubmissionResultContainer() {
  const container = findSubmissionResultContainer();
  if (!container || container === observedResultContainer) return;

  observer.disconnect();
  observedResultContainer = container;
  observer.observe(container, {
    childList: true,
    characterData: true,
    subtree: true
  });

  // If LeetCode replaced the whole result container between polling ticks,
  // verify its current state; the submission-ID guard still rejects stale UI.
  if (!isProcessing && nodeContainsAcceptedText(container)) {
    triggerPushSequence();
  }
}

function findSubmissionResultContainer() {
  return document.querySelector([
    '[data-e2e-locator="submission-result"]',
    '[data-e2e-locator="submission-result-container"]',
    '[data-e2e-locator="submission-result-pane"]',
    '[class*="submission-result"]',
    '[class*="result-container"]'
  ].join(','));
}

function mutationContainsAcceptedResult(mutation) {
  const changedNodes = mutation.type === 'characterData'
    ? [mutation.target.parentElement]
    : [...mutation.addedNodes];

  return changedNodes.some(node => node && nodeContainsAcceptedText(node));
}

function nodeContainsAcceptedText(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.trim() === 'Accepted';
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  if (node.textContent.trim() === 'Accepted') return true;

  return [...node.querySelectorAll('span, div, p, h3')]
    .some(element => element.textContent.trim() === 'Accepted');
}

// Sequence triggered upon detecting an Accepted status
function triggerPushSequence() {
  isProcessing = true;
  console.log("LeetPush: Accepted submission detected. Preparing push sequence in 2 seconds...");

  setTimeout(async () => {
    try {
      const slug = getProblemSlug();
      if (!slug) {
        throw new Error("Could not parse problem slug from URL");
      }

      console.log(`LeetPush: Fetching details for problem: ${slug}`);

      // 1. Fetch recent accepted submission
      const submission = await fetchRecentAcceptedSubmission(slug);
      if (!submission) {
        throw new Error("Could not find any recent Accepted submissions for this problem.");
      }

      // Reject stale or already-pushed IDs before fetching details or sending a push.
      const submissionId = Number(submission.id);
      const storedSubmissionId = await getLastSubmissionId();
      if (submissionId === Number(lastKnownSubmissionId) || submissionId === storedSubmissionId) {
        console.log(`LeetPush: Submission ${submission.id} is not new. Skipping.`);
        isProcessing = false;
        return;
      }
      lastKnownSubmissionId = submissionId;

      // 2. Fetch GraphQL problem details
      const problemDetails = await fetchProblemDetails(slug);
      
      // 3. Fetch Submission Details (code, runtime, memory, percentiles)
      const submissionDetails = await fetchSubmissionDetails(submission.id);

      // 4. Construct Payload
      const ext = LANG_MAP[submission.lang.toLowerCase()] || submission.lang.toLowerCase();
      const payload = {
        questionId: problemDetails.questionId,
        title: problemDetails.title,
        titleSlug: problemDetails.titleSlug,
        difficulty: problemDetails.difficulty,
        contentMarkdown: convertHtmlToMarkdown(problemDetails.content),
        topicTags: problemDetails.topicTags ? problemDetails.topicTags.map(t => t.name) : [],
        acceptanceRate: parseAcceptanceRate(problemDetails.stats),
        
        submissionId: submission.id,
        code: submissionDetails.code,
        language: submission.lang,
        extension: ext,
        runtime: submissionDetails.runtime || submission.runtime || '',
        runtimePercentile: submissionDetails.runtimePercentile || '',
        memory: submissionDetails.memory || submission.memory || '',
        memoryPercentile: submissionDetails.memoryPercentile || ''
      };

      console.log("LeetPush: Sending solution payload to background worker...", payload);

      // Send to background worker
      chrome.runtime.sendMessage({ type: "LEETPUSH_SUBMIT", payload }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("LeetPush: Message transfer failed: ", chrome.runtime.lastError);
        } else if (response && response.success) {
          console.log("LeetPush: Solution successfully pushed!");
        } else {
          console.error("LeetPush: Background script returned error: ", response ? response.error : "Unknown error");
        }
        
        // Reset processing state after a short cooling-off period
        setTimeout(() => { isProcessing = false; }, 8000);
      });

    } catch (err) {
      console.error("LeetPush: Error in push sequence: ", err);
      // Send error notification from background
      chrome.runtime.sendMessage({ 
        type: "LEETPUSH_ERROR", 
        error: err.message || "An unknown error occurred during collection."
      });
      isProcessing = false;
    }
  }, 2000);
}

// Parses slug from URLs like leetcode.com/problems/two-sum/
function getProblemSlug() {
  const match = window.location.pathname.match(/\/problems\/([^/]+)/);
  return match ? match[1] : null;
}

// Fetch recent accepted submissions using the REST API with retries
async function fetchRecentAcceptedSubmission(slug, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(`/api/submissions/?offset=0&limit=10&slug=${slug}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      if (data && data.submissions_dump) {
        const accepted = data.submissions_dump.filter(s => s.status_display === 'Accepted');
        if (accepted.length > 0) {
          return accepted[0]; // Most recent is first
        }
      }
    } catch (e) {
      console.warn(`Attempt ${i + 1} to fetch submissions failed:`, e);
    }
    // Wait 1.5 seconds before retrying
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return null;
}

// Fetch problem content and details using GraphQL
async function fetchProblemDetails(slug) {
  const query = `
    query questionContent($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        titleSlug
        difficulty
        content
        topicTags {
          name
        }
        stats
      }
    }
  `;

  const response = await fetch('/graphql/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      query,
      variables: { titleSlug: slug }
    })
  });

  if (!response.ok) {
    throw new Error(`GraphQL query failed with status: ${response.status}`);
  }

  const resJson = await response.json();
  if (resJson.errors) {
    throw new Error(`GraphQL error: ${resJson.errors[0].message}`);
  }

  return resJson.data.question;
}

// Fetch details for a specific submission
async function fetchSubmissionDetails(submissionId) {
  const response = await fetch(`/api/submissions/${submissionId}/`);
  if (!response.ok) {
    // Attempt fallback to submissions/detail check
    return fetchSubmissionDetailsFallback(submissionId);
  }

  const data = await response.json();
  return {
    code: data.code,
    runtime: data.runtime || '',
    runtimePercentile: data.runtime_percentile || data.runtimePercentile || '',
    memory: data.memory || '',
    memoryPercentile: data.memory_percentile || data.memoryPercentile || ''
  };
}

// Fallback method for submission details if REST endpoint changes
async function fetchSubmissionDetailsFallback(submissionId) {
  const response = await fetch(`/submissions/detail/${submissionId}/check/`);
  if (!response.ok) {
    throw new Error(`Failed to fetch submission details. Status: ${response.status}`);
  }
  
  const data = await response.json();
  return {
    code: data.code,
    runtime: data.status_runtime || '',
    runtimePercentile: data.runtime_percentile || '',
    memory: data.status_memory || '',
    memoryPercentile: data.memory_percentile || ''
  };
}

// Read the persisted ID before any collection or push work begins.
async function getLastSubmissionId() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ lastSubmissionId: 0 }, (items) => {
      resolve(Number(items.lastSubmissionId));
    });
  });
}

// Helper to parse acceptance rate from stats string
function parseAcceptanceRate(statsString) {
  if (!statsString) return '';
  try {
    const statsObj = JSON.parse(statsString);
    return statsObj.acRate || '';
  } catch (e) {
    return '';
  }
}

// Pure HTML to Markdown parser for problem descriptions
function convertHtmlToMarkdown(html) {
  if (!html) return '';
  
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    let childrenContent = '';
    node.childNodes.forEach(child => {
      childrenContent += cleanNode(child);
    });

    const tag = node.tagName.toLowerCase();
    switch (tag) {
      case 'h1': return `\n# ${childrenContent.trim()}\n`;
      case 'h2': return `\n## ${childrenContent.trim()}\n`;
      case 'h3': return `\n### ${childrenContent.trim()}\n`;
      case 'h4': return `\n#### ${childrenContent.trim()}\n`;
      case 'h5': return `\n##### ${childrenContent.trim()}\n`;
      case 'h6': return `\n###### ${childrenContent.trim()}\n`;
      case 'p': return `\n${childrenContent.trim()}\n`;
      case 'br': return `\n`;
      case 'strong':
      case 'b': return `**${childrenContent}**`;
      case 'em':
      case 'i': return `*${childrenContent}*`;
      case 'sub': return `<sub>${childrenContent}</sub>`;
      case 'sup': return `<sup>${childrenContent}</sup>`;
      case 'code': {
        if (node.parentNode && node.parentNode.tagName.toLowerCase() === 'pre') {
          return childrenContent;
        }
        return `\`${childrenContent}\``;
      }
      case 'pre': {
        return `\n\`\`\`\n${childrenContent.trim()}\n\`\`\`\n`;
      }
      case 'ul': return `\n${childrenContent}\n`;
      case 'ol': return `\n${childrenContent}\n`;
      case 'li': {
        const isOl = node.parentNode && node.parentNode.tagName.toLowerCase() === 'ol';
        if (isOl) {
          const index = Array.from(node.parentNode.children).indexOf(node) + 1;
          return `${index}. ${childrenContent.trim()}\n`;
        }
        return `- ${childrenContent.trim()}\n`;
      }
      case 'a': {
        const href = node.getAttribute('href') || '';
        return `[${childrenContent}](${href})`;
      }
      case 'img': {
        const alt = node.getAttribute('alt') || 'image';
        const src = node.getAttribute('src') || '';
        return `![${alt}](${src})`;
      }
      case 'blockquote': return `\n> ${childrenContent.trim().replace(/\n/g, '\n> ')}\n`;
      case 'table': return `\n${childrenContent}\n`;
      case 'thead': return childrenContent;
      case 'tbody': return childrenContent;
      case 'tr': return `\n| ${childrenContent} |`;
      case 'th':
      case 'td': return `${childrenContent.trim()} |`;
      default:
        return childrenContent;
    }
  }

  let markdown = '';
  body.childNodes.forEach(child => {
    markdown += cleanNode(child);
  });

  return markdown
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
