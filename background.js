const extOpts = {
  // todo: make the options part of configurable settings in popup
  aiReady: (() => {
    if (!ai || !ai.languageModel || !ai.summarizer || !ai.rewriter)
      return false;
    return true;
  })(),
  timeout: 20000,
  summaryEnabled: true,
  debug: true,
  minLength: 50,
};

const log = {
  info: console.log.bind(console, "%c[INFO]", "color: #00ff00"),
  warn: console.log.bind(console, "%c[WARN]", "color: #ffcc00"),
  error: console.log.bind(console, "%c[ERROR]", "color: #ff0000"),
};

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
async function getSummary(longText) {
  /**
   todo: test if better to use:
   -  session = await ai.languageModel.create();
   -  rewriter = await ai.rewriter.create();
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

/**
 * Adds the current tab to OmniFocus with optional AI summary
 * @param {chrome.tabs.Tab} tab - The browser tab to add to OmniFocus
 * @returns {Promise<void>}
 */
async function addToOmniFocus(tab, { doAI = true } = {}) {
  if (!tab || !tab.url) throw new Error("Invalid tab provided");

  let noteContent = tab.url;
  log.info(`adding to omnifocus: {AI: ${doAI}}`);

  if (doAI && extOpts.summaryEnabled && extOpts.aiReady) {
    try {
      const pageText = await getTextContent(tab);
      const summary = await withTimeout(
        getSummary(pageText),
        extOpts.timeout,
        `Timeout getting summary for ${tab.url}`
      );

      if (summary) noteContent = `${tab.url}\n\n${summary}`;
    } catch (err) {
      log.error(err.message);
    }
  }

  try {
    let item = {
      name: encodeURIComponent(tab.title),
      note: encodeURIComponent(noteContent),
    };

    const omnifocusUrl = `omnifocus:///add?name=${item.name}&note=${item.note}`;

    chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
      setTimeout(() => chrome.tabs.remove(newTab.id), 500);
    });
  } catch (error) {
    log.error("Failed to create OmniFocus task:", error);
  }
}

// This was here originally, but its not clear to me if I should have this
// Set up a dynamic popup URL based on Command key (empty = no popup)
chrome.action.setPopup({ popup: "" }); // Default to no popup (direct add)
// chrome.action.setPopup({ popup: "popup.html" });

// Message action handlers
const messageHandlers = {
  // Handle Command key pressed
  modifierKeyPressed: (message, sender, sendResponse) => {
    if (message.commandKey) {
      chrome.action.setPopup({ popup: "popup.html" });
      sendResponse({ success: true });
    }
    return false; // Synchronous response
  },

  // Handle Command key released
  modifierKeyReleased: (message, sender, sendResponse) => {
    chrome.action.setPopup({ popup: "" });
    sendResponse({ success: true });
    return false; // Synchronous response
  },

  // Handle add to OmniFocus request from popup
  addToOmnifocusPopup: (message, sender, sendResponse) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        addToOmniFocus(tabs[0])
          .then(() => {
            sendResponse({ success: true });
          })
          .catch((error) => {
            sendResponse({ success: false, error: error.message });
          });
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return true; // Async response, keep the channel open
  },
};

// Main message listener with dispatch pattern
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  // Check if we have a handler for this action
  if (action && messageHandlers[action]) {
    // Call the appropriate handler and get whether we need async response
    const needsAsyncResponse = messageHandlers[action](
      message,
      sender,
      sendResponse
    );
    return needsAsyncResponse; // Return true to keep the message channel open if needed
  } else {
    log.warn("Unknown message action:", action);
  }
});

// Handle direct clicks (when popup is not shown)
chrome.action.onClicked.addListener((tab) => {
  addToOmniFocus(tab)
    .then(() => {})
    .catch((err) => {});
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === "addToOmnifocusPopup") {
    // TODO: ideally would open up the popup here, as is, does not seem to work
    // this only seems to work if the popup has already been opened, then the keyboard shortcut works?
    // also seems to work if i do the `addToOmnifocusPopup` keyboard shortcut and then the `_execute_action` keyboard shortcut...
    chrome.action.setPopup({ popup: "popup.html" });
  }
});
