const extOpts = {
  // todo: make the options part of configurable settings in popup
  aiReady: (() => {
    if (!ai || !ai.languageModel || !ai.summarizer || !ai.rewriter)
      return false;
    return true;
  })(),
  timeout: 7000,
  summaryEnabled: true,
  debug: true,
  minLength: 50,
  summaryFn: getPromptSummary,
};

// Minimal logger
const log = (() => {
  const fmt =
    (level, color) =>
    (...args) =>
      console[level === "debug" ? "log" : level](
        `%c[${new Date().toTimeString().slice(0, 8)}][${level.toUpperCase()}]`,
        `color:${color}`,
        ...args
      );
  return {
    debug: extOpts.debug ? fmt("debug", "#888") : () => {},
    info: fmt("info", "#0c5"),
    warn: fmt("warn", "#f90"),
    error: fmt("error", "#f43"),
  };
})();

/**
 * Wraps a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} duration - Timeout in milliseconds
 * @param {string} message - Custom error message
 * @returns {Promise} - A promise that will reject if the timeout occurs
 */
async function withTimeout(promise, duration, message) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(
      () => reject(new Error(message || `Timed out after ${duration}ms`)),
      duration
    );
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Extracts the main text content from a tab
 * @param {chrome.tabs.Tab} tab - The browser tab to extract content from
 * @returns {string} The text content of the main article or body
 */
async function getTextContent(tab) {
  const [textResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      const article =
        document.querySelector("article") ||
        document.querySelector("main") ||
        document.body;
      return article.innerText.trim();
    },
  });
  return textResult.result;
}

/**
 * Extracts the full HTML content from a tab
 * @param {chrome.tabs.Tab} tab - The browser tab to extract HTML from
 * @returns {string} The full HTML content of the page
 */
async function getHtmlContent(tab) {
  const [htmlResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => document.documentElement.innerHTML,
  });
  return htmlResult.result;
}

/**
 * Generates a summary of provided text using Chrome's AI API
 * @param {string} longText - The text to summarize
 * @returns {Promise<string>} A summary of the text
 * @throws {Error} If AI summarization fails
 */
async function getSummarizerSummary(longText) {
  /**
   from some testing, it seems that the prompt is better than the summarizer
   --
   sharedContext: Additional shared context that can help the summarizer.
   type: The type of the summarization, with the allowed values key-points (default), tl;dr, teaser, and headline.
   format: The format of the summarization, with the allowed values markdown (default), and plain-text.
   length: The length of the summarization, with the allowed values short, medium (default), and long. The meanings of these
   lengths vary depending on the type requested. For example, in Chrome's implementation, a short key-points summary consists
   of three bullet points, and a short summary is one sentence; a long key-points summary is seven bullet points, and a long summary is a paragraph.
  **/

  // check if text is too short
  if (longText.length < extOpts.minLength) return "";

  const summarizer = await ai.summarizer.create({
    sharedContext: "Generate a single sentence summary of the following text",
    type: "headline", // Options: headline, key-points, tl;dr, teaser
    format: "markdown", // Options: markdown, plain-text
    length: "short", // Options: short, medium, long
  });

  return await summarizer.summarize(longText);
}

async function getPromptSummary(longText) {
  const session = await ai.languageModel.create({
    temperature: 0.7,
    topK: 40,
    systemPrompt: "Generate a single sentence summary of the following text.",
  });

  const prompt = await session.prompt(longText);
  return prompt;
}

/**
 * Adds the current tab to OmniFocus with optional AI summary
 * @param {chrome.tabs.Tab} tab - The browser tab to add to OmniFocus
 * @returns {Promise<void>}
 */
async function addToOmniFocus(tab, { doAI = true } = {}) {
  if (!tab || !tab.url) throw new Error("Invalid tab provided");

  let noteContent = tab.url;
  log.info(`adding to of:{AI:${doAI},Fn:${extOpts.summaryFn.name}}`);

  if (doAI && extOpts.summaryEnabled && extOpts.aiReady) {
    try {
      const pageText = await getTextContent(tab);
      const summary = await withTimeout(
        extOpts.summaryFn(pageText),
        extOpts.timeout,
        `Summary for ${tab.url}`
      );
      if (summary) noteContent = `${tab.url}\n\n${summary}`;
    } catch (err) {
      log.error(`Timeout`, err);
    }
  }

  const item = {
    name: encodeURIComponent(tab.title),
    note: encodeURIComponent(noteContent),
  };

  try {
    const omnifocusUrl = `omnifocus:///add?name=${item.name}&note=${item.note}`;

    chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
      setTimeout(() => chrome.tabs.remove(newTab.id), 500);
    });
  } catch (error) {
    log.error("Failed to create OmniFocus task:", error);
  }
}

const handlers = {
  addToOmnifocusPopupNoSummary: () => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          reject(new Error("No active tab found"));
          return;
        }
        addToOmniFocus(tabs[0], { doAI: false }).then(resolve).catch(reject);
      });
    });
  },
  addToOmnifocusPopupSummary: () => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          reject(new Error("No active tab found"));
          return;
        }
        addToOmniFocus(tabs[0], { doAI: true }).then(resolve).catch(reject);
      });
    });
  },
  openPopup: () => {
    chrome.action.setPopup({ popup: "popup.html" });
  },
};

// Main message listener with dispatch pattern
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (handlers[action]) {
    // Keep the message channel open for the async response
    handlers[action]()
      .then(() => {
        sendResponse({ success: true });
        chrome.action.setPopup({ popup: "" });
      })
      .catch((error) => {
        log.error("Failed to add to OmniFocus:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open
  }

  // Handle unknown action
  sendResponse({ success: false, error: `Unknown action: ${action}` });
  return false;
});

// Handle direct clicks (when popup is not shown)
chrome.action.onClicked.addListener((tab) => {
  handlers.openPopup();
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (handlers[command]) {
    handlers[command]();
  }
});
