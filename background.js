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
  info: (message, ...args) => {
    if (extOpts.debug) console.log(message, ...args);
  },
  warn: (message, ...args) => {
    console.warn(message, ...args);
  },
  error: (message, ...args) => {
    console.error(message, ...args);
  },
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

  if (
    typeof extOpts.minLength === "number" &&
    longText.length < extOpts.minLength
  ) {
    log.error("Text is too short for meaningful summarization");
    return "";
  }

  const summarizer = await ai.summarizer.create({
    sharedContext: "Generate a single sentence summary of the following text",
    type: "headline", // Options: headline, key-points, tl;dr, teaser
    format: "markdown", // Options: markdown, plain-text
    length: "short", // Options: short, medium, long
  });

  const summary = await summarizer.summarize(longText);
  return summary;
}

/**
 * Adds the current tab to OmniFocus with optional AI summary
 * @param {chrome.tabs.Tab} tab - The browser tab to add to OmniFocus
 * @returns {Promise<void>}
 */
async function addToOmniFocus(tab, { doAI = false } = {}) {
  if (!tab || !tab.url) {
    log.error("Invalid tab provided");
    return;
  }
  let noteContent = tab.url;

  if (doAI && extOpts.summaryEnabled && extOpts.aiReady) {
    try {
      const pageText = await getTextContent(tab);
      const summary = await withTimeout(
        getSummary(pageText),
        extOpts.timeout,
        `Timeout getting summary for ${tab.url}`
      );

      if (summary) noteContent = `${tab.url}\n\n${summary}`;
    } catch (error) {
      log.warn(error.message);
    }
  }

  try {
    const itemName = encodeURIComponent(tab.title);
    const itemNote = encodeURIComponent(noteContent);
    const omnifocusUrl = `omnifocus:///add?name=${itemName}&note=${itemNote}`;

    chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
      if (!newTab) {
        log.error("Failed to create OmniFocus tab");
        return;
      }

      // Close the newly created tab after a short delay
      setTimeout(() => {
        chrome.tabs.remove(newTab.id);
        log.info("OmniFocus task created and tab closed");
      }, 500);
    });
  } catch (finalError) {
    log.error("Failed to create OmniFocus task:", finalError);
  }
}

// Set up a dynamic popup URL based on Command key (empty = no popup)
chrome.action.setPopup({ popup: "" }); // Default to no popup (direct add)

// Create a listener for key presses
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message.action === "modifierKeyPressedOmniExtension" &&
    message.commandKey
  ) {
    // If Command key is pressed, show the popup
    chrome.action.setPopup({ popup: "popup.html" });
    sendResponse({ success: true });
  } else if (message.action === "modifierKeyReleasedOmniExtension") {
    chrome.action.setPopup({ popup: "" });
    sendResponse({ success: true });
  } else if (message.action === "addToOmniFocus") {
    // Handle add requests from the popup
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
    return true; // Required for async sendResponse
  }
});

// Handle direct clicks (when popup is not shown)
chrome.action.onClicked.addListener((tab) => {
  addToOmniFocus(tab)
    .then(() => {})
    .catch((error) => {
      log.error("onClicked:", error);
    });
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === "add_to_omnifocus") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0]) {
        addToOmniFocus(tabs[0])
          .then(() => {})
          .catch((err) => {
            log.error("onCommand:", err);
          });
      }
    });
  }
});
