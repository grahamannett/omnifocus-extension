// Import the AI service at the top of background scripts
let chromeAI = null;

const extOpts = {
  timeout: 7000,
  summaryEnabled: true,
  debug: true,
  minLength: 50,
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
 * Initialize the Chrome AI service
 */
async function initializeAIService() {
  try {
    // Dynamically import the AI service
    const { ChromeAIService } = await import('./ai-service.js');
    chromeAI = new ChromeAIService();
    await chromeAI.initialize();
    
    const availability = await chromeAI.checkAvailability();
    log.info('AI Service initialized:', availability);
    
    return availability.available;
  } catch (error) {
    log.error('Failed to initialize AI service:', error);
    return false;
  }
}

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
 * Generates a summary using the Chrome AI service
 * @param {string} text - The text to summarize
 * @param {Object} options - Summary options
 * @returns {Promise<string>} A summary of the text
 */
async function generateSummary(text, options = {}) {
  if (!chromeAI) {
    const aiAvailable = await initializeAIService();
    if (!aiAvailable) {
      throw new Error('Chrome AI service not available');
    }
  }

  // Check if text is too short
  if (text.length < extOpts.minLength) {
    return "";
  }

  const summaryOptions = {
    type: 'headline',
    format: 'plain-text',
    length: 'short',
    context: 'This is a summary for a task in OmniFocus',
    ...options
  };

  try {
    const summary = await chromeAI.summarize(text, summaryOptions);
    return summary;
  } catch (error) {
    log.error('Summary generation failed:', error);
    throw error;
  }
}

/**
 * Adds the current tab to OmniFocus with optional AI summary
 * @param {chrome.tabs.Tab} tab - The browser tab to add to OmniFocus
 * @returns {Promise<void>}
 */
async function addToOmniFocus(tab, { doAI = true } = {}) {
  if (!tab || !tab.url) throw new Error("Invalid tab provided");

  let noteContent = tab.url;
  log.info(`Adding to OmniFocus: {AI:${doAI}}`);

  if (doAI && extOpts.summaryEnabled) {
    try {
      const pageText = await getTextContent(tab);
      const summary = await withTimeout(
        generateSummary(pageText),
        extOpts.timeout,
        `Summary for ${tab.url}`
      );
      if (summary) {
        noteContent = `${tab.url}\n\n${summary}`;
      }
    } catch (err) {
      log.error(`Summary generation failed:`, err);
      // Continue with just the URL if summary fails
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
  checkAIAvailability: async () => {
    if (!chromeAI) {
      await initializeAIService();
    }
    if (chromeAI) {
      return await chromeAI.checkAvailability();
    }
    return { available: false, status: 'unavailable', version: null };
  }
};

// Main message listener with dispatch pattern
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (handlers[action]) {
    // Handle async actions
    if (action === 'checkAIAvailability') {
      handlers[action]()
        .then(result => sendResponse({ success: true, data: result }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Keep message channel open for async response
    }
    
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

// Initialize AI service when the extension starts
chrome.runtime.onInstalled.addListener(async () => {
  log.info('Extension installed/updated');
  await initializeAIService();
});
