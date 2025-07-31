// OmniFocus Tab Saver - Background Service Worker

// Default settings
const DEFAULT_SETTINGS = {
  summaryEnabled: true,
  summaryType: 'headline',
  summaryLength: 'short',
  timeout: 7000,
  debug: false,
  minTextLength: 50
};

// Current settings (will be loaded from storage)
let settings = { ...DEFAULT_SETTINGS };

// Logger utility
const log = {
  debug: (...args) => settings.debug && console.log('[DEBUG]', ...args),
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

// Load settings from storage
async function loadSettings() {
  try {
    const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    settings = { ...DEFAULT_SETTINGS, ...stored };
    log.debug('Settings loaded:', settings);
  } catch (error) {
    log.error('Failed to load settings:', error);
  }
}

// Save settings to storage
async function saveSettings(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    await chrome.storage.sync.set(settings);
    log.debug('Settings saved:', settings);
  } catch (error) {
    log.error('Failed to save settings:', error);
  }
}

// AI capability detection
class AICapabilities {
  static async check() {
    const capabilities = {
      available: false,
      languageModel: false,
      summarizer: false,
      rewriter: false,
      error: null
    };

    try {
      if (typeof ai === 'undefined') {
        capabilities.error = 'Chrome AI not available';
        return capabilities;
      }

      capabilities.available = true;

      // Check language model
      if (ai.languageModel) {
        try {
          const canCreate = await ai.languageModel.capabilities();
          capabilities.languageModel = canCreate.available === 'readily';
        } catch (e) {
          log.debug('Language model check failed:', e);
        }
      }

      // Check summarizer
      if (ai.summarizer) {
        try {
          const canCreate = await ai.summarizer.capabilities();
          capabilities.summarizer = canCreate.available === 'readily';
        } catch (e) {
          log.debug('Summarizer check failed:', e);
        }
      }

      // Check rewriter
      if (ai.rewriter) {
        try {
          const canCreate = await ai.rewriter.capabilities();
          capabilities.rewriter = canCreate.available === 'readily';
        } catch (e) {
          log.debug('Rewriter check failed:', e);
        }
      }
    } catch (error) {
      capabilities.error = error.message;
      log.error('AI capability check failed:', error);
    }

    return capabilities;
  }
}

// Utility to add timeout to promises
async function withTimeout(promise, duration, message) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message || `Timeout after ${duration}ms`)), duration);
  });
  return Promise.race([promise, timeoutPromise]);
}

// Extract text content from a tab
async function getTextContent(tab) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // Try to find the main content area
        const article = document.querySelector('article') || 
                       document.querySelector('main') || 
                       document.querySelector('[role="main"]') ||
                       document.querySelector('.content') ||
                       document.body;
        
        // Clean up the text
        const text = article.innerText || article.textContent || '';
        return text.trim().replace(/\s+/g, ' ').substring(0, 5000); // Limit to 5000 chars
      }
    });
    return result.result;
  } catch (error) {
    log.error('Failed to extract text content:', error);
    return '';
  }
}

// Generate AI summary using language model
async function generatePromptSummary(text) {
  if (!text || text.length < settings.minTextLength) {
    return '';
  }

  try {
    const session = await ai.languageModel.create({
      temperature: 0.7,
      topK: 40,
      systemPrompt: `Generate a single ${settings.summaryType} summary of the following text. 
                     Keep it ${settings.summaryLength} and informative.`
    });

    const summary = await session.prompt(text);
    session.destroy();
    return summary;
  } catch (error) {
    log.error('Prompt summary failed:', error);
    throw error;
  }
}

// Generate AI summary using summarizer API
async function generateSummarizerSummary(text) {
  if (!text || text.length < settings.minTextLength) {
    return '';
  }

  try {
    const summarizer = await ai.summarizer.create({
      type: settings.summaryType,
      format: 'plain-text',
      length: settings.summaryLength
    });

    const summary = await summarizer.summarize(text);
    summarizer.destroy();
    return summary;
  } catch (error) {
    log.error('Summarizer failed:', error);
    throw error;
  }
}

// Add tab to OmniFocus
async function addToOmniFocus(tab, options = {}) {
  const { includeSummary = true } = options;
  
  if (!tab || !tab.url || !tab.title) {
    throw new Error('Invalid tab data');
  }

  let noteContent = tab.url;
  let summaryGenerated = false;

  // Try to generate summary if enabled
  if (includeSummary && settings.summaryEnabled) {
    try {
      const capabilities = await AICapabilities.check();
      
      if (capabilities.languageModel || capabilities.summarizer) {
        const pageText = await getTextContent(tab);
        
        if (pageText) {
          let summary = '';
          
          // Try language model first (usually better)
          if (capabilities.languageModel) {
            try {
              summary = await withTimeout(
                generatePromptSummary(pageText),
                settings.timeout,
                'Summary generation timed out'
              );
            } catch (e) {
              log.debug('Language model summary failed:', e);
            }
          }
          
          // Fall back to summarizer if needed
          if (!summary && capabilities.summarizer) {
            try {
              summary = await withTimeout(
                generateSummarizerSummary(pageText),
                settings.timeout,
                'Summary generation timed out'
              );
            } catch (e) {
              log.debug('Summarizer API failed:', e);
            }
          }
          
          if (summary) {
            noteContent = `${tab.url}\n\n${summary}`;
            summaryGenerated = true;
          }
        }
      }
    } catch (error) {
      log.error('Summary generation failed:', error);
    }
  }

  // Create OmniFocus URL
  const omnifocusUrl = `omnifocus:///add?name=${encodeURIComponent(tab.title)}&note=${encodeURIComponent(noteContent)}`;
  
  // Open and quickly close the URL
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      
      // Close the tab after a short delay
      setTimeout(() => {
        chrome.tabs.remove(newTab.id).catch(() => {
          // Ignore errors when closing (tab might already be closed)
        });
      }, 500);
      
      resolve({ success: true, summaryGenerated });
    });
  });
}

// Message handlers
const messageHandlers = {
  async addToOmniFocus(data, sender) {
    const { includeSummary = true } = data;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    return await addToOmniFocus(tab, { includeSummary });
  },

  async getAICapabilities() {
    return await AICapabilities.check();
  },

  async getSettings() {
    return settings;
  },

  async saveSettings(data) {
    await saveSettings(data.settings);
    return { success: true };
  }
};

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action, ...data } = message;
  
  if (messageHandlers[action]) {
    messageHandlers[action](data, sender)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(error => {
        log.error(`Action ${action} failed:`, error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep message channel open for async response
  }
  
  sendResponse({ success: false, error: `Unknown action: ${action}` });
});

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      log.error('No active tab for command:', command);
      return;
    }
    
    switch (command) {
      case 'quick-add-with-summary':
        await addToOmniFocus(tab, { includeSummary: true });
        break;
      case 'quick-add-no-summary':
        await addToOmniFocus(tab, { includeSummary: false });
        break;
    }
  } catch (error) {
    log.error('Command failed:', command, error);
  }
});

// Handle extension icon click (when popup is disabled)
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await addToOmniFocus(tab, { includeSummary: settings.summaryEnabled });
  } catch (error) {
    log.error('Failed to add tab to OmniFocus:', error);
  }
});

// Initialize on install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  await loadSettings();
  
  if (details.reason === 'install') {
    // Open options page on first install
    chrome.runtime.openOptionsPage();
  }
});

// Load settings on startup
chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
});

// Initialize settings
loadSettings();
