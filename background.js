// Chrome AI API Abstraction Layer
class ChromeAIAbstraction {
  constructor() {
    this.apiReady = false;
    this.summarizer = null;
    this.apiType = null; // 'stable', 'experimental', or 'unavailable'
    this.debug = true;
  }

  // Modern feature detection for Chrome AI APIs
  async checkAvailability() {
    // Check for stable Summarizer API (Chrome 138+)
    if (typeof Summarizer !== 'undefined' && Summarizer.availability) {
      try {
        const availability = await Summarizer.availability();
        if (availability === 'available' || availability === 'downloadable' || availability === 'downloading') {
          this.apiType = 'stable';
          this.apiReady = true;
          this.log('info', 'Stable Summarizer API detected');
          return true;
        }
      } catch (error) {
        this.log('warn', 'Stable API check failed:', error);
      }
    }

    // Check for experimental API (legacy support)
    if (typeof ai !== 'undefined' && ai?.summarizer) {
      this.apiType = 'experimental';
      this.apiReady = true;
      this.log('info', 'Experimental AI API detected');
      return true;
    }

    // Check for Prompt API as fallback
    if (typeof ai !== 'undefined' && ai?.languageModel) {
      this.apiType = 'prompt';
      this.apiReady = true;
      this.log('info', 'Prompt API detected as fallback');
      return true;
    }

    this.apiType = 'unavailable';
    this.apiReady = false;
    this.log('warn', 'No Chrome AI APIs available');
    return false;
  }

  // Create summarizer with modern API
  async createSummarizer(options = {}) {
    if (!this.apiReady) {
      await this.checkAvailability();
    }

    const defaultOptions = {
      type: 'tldr',
      format: 'plain-text',
      length: 'short',
      sharedContext: 'Generate a concise summary of the following text'
    };

    const config = { ...defaultOptions, ...options };

    try {
      if (this.apiType === 'stable') {
        const availability = await Summarizer.availability();
        
        if (availability === 'unavailable') {
          throw new Error('Summarizer API is not available');
        }

        // Handle model download if needed
        if (availability === 'downloadable' || availability === 'downloading') {
          this.log('info', 'Downloading AI model...');
          this.summarizer = await Summarizer.create({
            type: config.type,
            format: config.format,
            length: config.length,
            sharedContext: config.sharedContext,
            monitor: (m) => {
              m.addEventListener('downloadprogress', (e) => {
                this.log('debug', `Model download: ${Math.round(e.loaded * 100)}%`);
              });
            }
          });
          
          if (availability === 'downloading') {
            await this.summarizer.ready;
          }
        } else {
          this.summarizer = await Summarizer.create({
            type: config.type,
            format: config.format,
            length: config.length,
            sharedContext: config.sharedContext
          });
        }
      } else if (this.apiType === 'experimental') {
        this.summarizer = await ai.summarizer.create({
          type: config.type,
          format: config.format,
          length: config.length,
          sharedContext: config.sharedContext
        });
      } else {
        throw new Error('No compatible AI API available');
      }

      this.log('info', `Summarizer created using ${this.apiType} API`);
      return this.summarizer;
    } catch (error) {
      this.log('error', 'Failed to create summarizer:', error);
      throw error;
    }
  }

  // Universal summarize method
  async summarize(text, options = {}) {
    if (!this.summarizer) {
      await this.createSummarizer();
    }

    try {
      const context = options.context || '';
      
      if (this.apiType === 'stable') {
        return await this.summarizer.summarize(text, { context });
      } else if (this.apiType === 'experimental') {
        return await this.summarizer.summarize(text);
      } else if (this.apiType === 'prompt') {
        return await this.promptSummary(text, options);
      } else {
        throw new Error('No summarizer available');
      }
    } catch (error) {
      this.log('error', 'Summarization failed:', error);
      throw error;
    }
  }

  // Fallback to Prompt API for summarization
  async promptSummary(text, options = {}) {
    try {
      const session = await ai.languageModel.create({
        temperature: 0.7,
        topK: 40,
        systemPrompt: options.systemPrompt || "Generate a single sentence summary of the following text."
      });

      const summary = await session.prompt(text);
      return summary;
    } catch (error) {
      this.log('error', 'Prompt API summarization failed:', error);
      throw error;
    }
  }

  // Get API status information
  getStatus() {
    return {
      ready: this.apiReady,
      type: this.apiType,
      hasSummarizer: !!this.summarizer
    };
  }

  // Cleanup resources
  cleanup() {
    if (this.summarizer && this.summarizer.destroy) {
      this.summarizer.destroy();
    }
    this.summarizer = null;
  }

  // Logging helper
  log(level, ...args) {
    if (!this.debug && level === 'debug') return;
    
    const colors = {
      debug: '#888',
      info: '#0c5',
      warn: '#f90',
      error: '#f43'
    };

    console[level === 'debug' ? 'log' : level](
      `%c[${new Date().toTimeString().slice(0, 8)}][AI-${level.toUpperCase()}]`,
      `color:${colors[level]}`,
      ...args
    );
  }
}

// Initialize the AI abstraction
const chromeAI = new ChromeAIAbstraction();

// Extension configuration
const extOpts = {
  timeout: 10000, // Increased timeout for model downloads
  summaryEnabled: true,
  debug: true,
  minLength: 50,
};

// Initialize AI on startup
chromeAI.checkAvailability().then(available => {
  if (available) {
    chromeAI.log('info', 'Chrome AI initialized successfully');
  } else {
    chromeAI.log('warn', 'Chrome AI not available - summaries will be disabled');
  }
});

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
      // Try to get the main content area
      const article = document.querySelector('article') ||
                     document.querySelector('main') ||
                     document.querySelector('[role="main"]') ||
                     document.querySelector('.content') ||
                     document.querySelector('#content') ||
                     document.body;
      
      // Get clean text content
      const text = article.innerText.trim();
      
      // Remove excessive whitespace
      return text.replace(/\s+/g, ' ').trim();
    },
  });
  return textResult.result;
}

/**
 * Generates a summary using the Chrome AI abstraction
 * @param {string} text - The text to summarize
 * @param {object} options - Summarization options
 * @returns {Promise<string>} A summary of the text
 */
async function generateSummary(text, options = {}) {
  if (!text || text.length < extOpts.minLength) {
    return '';
  }

  try {
    return await chromeAI.summarize(text, {
      context: options.context || 'This is web content that needs to be summarized for a productivity application.',
      ...options
    });
  } catch (error) {
    chromeAI.log('error', 'Summary generation failed:', error);
    return '';
  }
}

/**
 * Adds the current tab to OmniFocus with optional AI summary
 * @param {chrome.tabs.Tab} tab - The browser tab to add to OmniFocus
 * @param {object} options - Configuration options
 * @returns {Promise<void>}
 */
async function addToOmniFocus(tab, { doAI = true } = {}) {
  if (!tab || !tab.url) {
    throw new Error('Invalid tab provided');
  }

  let noteContent = tab.url;
  
  chromeAI.log('info', `Adding to OmniFocus: ${tab.title}`, { 
    ai: doAI, 
    apiType: chromeAI.apiType,
    apiReady: chromeAI.apiReady 
  });

  // Generate AI summary if enabled and available
  if (doAI && extOpts.summaryEnabled && chromeAI.apiReady) {
    try {
      const pageText = await getTextContent(tab);
      
      if (pageText && pageText.length >= extOpts.minLength) {
        chromeAI.log('debug', `Generating summary for ${pageText.length} characters`);
        
        const summary = await withTimeout(
          generateSummary(pageText, {
            context: `This is web content from "${tab.title}" that needs a brief summary.`
          }),
          extOpts.timeout,
          `Summary generation timed out for ${tab.url}`
        );

        if (summary && summary.trim()) {
          noteContent = `${tab.url}\n\n${summary.trim()}`;
          chromeAI.log('info', 'Summary generated successfully');
        } else {
          chromeAI.log('warn', 'Empty summary generated');
        }
      } else {
        chromeAI.log('debug', 'Page text too short for summary');
      }
    } catch (error) {
      chromeAI.log('error', 'Summary generation failed:', error);
      // Continue without summary
    }
  }

  // Create OmniFocus task
  const item = {
    name: encodeURIComponent(tab.title),
    note: encodeURIComponent(noteContent),
  };

  try {
    const omnifocusUrl = `omnifocus:///add?name=${item.name}&note=${item.note}`;
    
    chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
      // Close the OmniFocus URL tab after a short delay
      setTimeout(() => {
        if (newTab && newTab.id) {
          chrome.tabs.remove(newTab.id);
        }
      }, 500);
    });
    
    chromeAI.log('info', 'Successfully added to OmniFocus');
  } catch (error) {
    chromeAI.log('error', 'Failed to create OmniFocus task:', error);
    throw error;
  }
}

// Message handlers
const handlers = {
  addToOmnifocusPopupNoSummary: () => {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0]) {
          reject(new Error('No active tab found'));
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
          reject(new Error('No active tab found'));
          return;
        }
        addToOmniFocus(tabs[0], { doAI: true }).then(resolve).catch(reject);
      });
    });
  },

  getAIStatus: () => {
    return Promise.resolve(chromeAI.getStatus());
  },

  openPopup: () => {
    chrome.action.setPopup({ popup: "popup.html" });
    return Promise.resolve();
  },
};

// Main message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (handlers[action]) {
    handlers[action]()
      .then((result) => {
        sendResponse({ success: true, result });
        // Reset popup after action
        if (action !== 'getAIStatus') {
          chrome.action.setPopup({ popup: "" });
        }
      })
      .catch((error) => {
        chromeAI.log('error', `Handler '${action}' failed:`, error);
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
    handlers[command]().catch(error => {
      chromeAI.log('error', `Command '${command}' failed:`, error);
    });
  }
});

// Cleanup on extension unload
chrome.runtime.onSuspend.addListener(() => {
  chromeAI.cleanup();
});
