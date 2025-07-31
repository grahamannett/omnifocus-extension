// OmniFocus Tab Saver - Background Service Worker
// Modern rewrite with proper async/await patterns and robust error handling

/**
 * Extension Configuration
 */
const CONFIG = {
  timeout: 10000, // 10 seconds for AI operations
  minTextLength: 100, // Minimum text length for summarization
  debug: true,
  omnifocusScheme: 'omnifocus:///add',
  tabCleanupDelay: 1000, // 1 second delay before closing OmniFocus tab
};

/**
 * Enhanced logging with timestamps and levels
 */
const Logger = {
  _log(level, color, ...args) {
    if (!CONFIG.debug && level === 'debug') return;
    
    const timestamp = new Date().toTimeString().slice(0, 8);
    const prefix = `%c[${timestamp}][${level.toUpperCase()}]`;
    
    console[level === 'debug' ? 'log' : level](
      prefix,
      `color: ${color}; font-weight: bold;`,
      ...args
    );
  },
  
  debug: (...args) => Logger._log('debug', '#888', ...args),
  info: (...args) => Logger._log('info', '#0c5', ...args),
  warn: (...args) => Logger._log('warn', '#f90', ...args),
  error: (...args) => Logger._log('error', '#f43', ...args),
};

/**
 * AI Service Manager
 * Handles detection and usage of Chrome's AI capabilities
 */
class AIService {
  constructor() {
    this.capabilities = {
      languageModel: false,
      summarizer: false,
      ready: false,
    };
    this.initialized = false;
  }
  
  /**
   * Asynchronously detect AI capabilities
   */
  async detectCapabilities() {
    try {
      Logger.info('Detecting AI capabilities...');
      
      // Check if ai object exists
      if (typeof ai === 'undefined') {
        Logger.warn('Chrome AI not available - ai object undefined');
        return this.capabilities;
      }
      
      // Check language model capability
      if (ai.languageModel) {
        try {
          const modelCapabilities = await ai.languageModel.capabilities();
          this.capabilities.languageModel = modelCapabilities.available === 'readily';
          Logger.debug('Language Model available:', this.capabilities.languageModel);
        } catch (error) {
          Logger.warn('Language Model check failed:', error.message);
        }
      }
      
      // Check summarizer capability
      if (ai.summarizer) {
        try {
          const summarizerCapabilities = await ai.summarizer.capabilities();
          this.capabilities.summarizer = summarizerCapabilities.available === 'readily';
          Logger.debug('Summarizer available:', this.capabilities.summarizer);
        } catch (error) {
          Logger.warn('Summarizer check failed:', error.message);
        }
      }
      
      this.capabilities.ready = this.capabilities.languageModel || this.capabilities.summarizer;
      this.initialized = true;
      
      Logger.info('AI Capabilities detected:', this.capabilities);
      return this.capabilities;
      
    } catch (error) {
      Logger.error('Failed to detect AI capabilities:', error);
      this.capabilities.ready = false;
      this.initialized = true;
      return this.capabilities;
    }
  }
  
  /**
   * Generate summary using available AI service
   */
  async generateSummary(text) {
    if (!this.initialized) {
      await this.detectCapabilities();
    }
    
    if (!this.capabilities.ready) {
      throw new Error('AI services not available');
    }
    
    if (text.length < CONFIG.minTextLength) {
      throw new Error(`Text too short (${text.length} chars, minimum ${CONFIG.minTextLength})`);
    }
    
    Logger.debug(`Generating summary for ${text.length} characters...`);
    
    // Try language model first (generally better results)
    if (this.capabilities.languageModel) {
      return await this._generateWithLanguageModel(text);
    }
    
    // Fallback to summarizer
    if (this.capabilities.summarizer) {
      return await this._generateWithSummarizer(text);
    }
    
    throw new Error('No AI services available for summarization');
  }
  
  async _generateWithLanguageModel(text) {
    try {
      const session = await ai.languageModel.create({
        temperature: 0.3,
        topK: 40,
        systemPrompt: 'Generate a concise, single-sentence summary of the following web page content. Focus on the main topic and key information.',
      });
      
      const summary = await session.prompt(text);
      session.destroy(); // Clean up session
      
      Logger.debug('Language model summary generated:', summary.slice(0, 100) + '...');
      return summary.trim();
      
    } catch (error) {
      Logger.error('Language model summarization failed:', error);
      throw error;
    }
  }
  
  async _generateWithSummarizer(text) {
    try {
      const summarizer = await ai.summarizer.create({
        type: 'headline',
        format: 'plain-text',
        length: 'short',
      });
      
      const summary = await summarizer.summarize(text);
      summarizer.destroy(); // Clean up summarizer
      
      Logger.debug('Summarizer summary generated:', summary.slice(0, 100) + '...');
      return summary.trim();
      
    } catch (error) {
      Logger.error('Summarizer failed:', error);
      throw error;
    }
  }
}

/**
 * Content Extraction Service
 * Handles extraction of text content from web pages
 */
class ContentExtractor {
  /**
   * Extract clean text content from a tab
   */
  static async extractText(tab) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: ContentExtractor._extractTextFromPage,
      });
      
      const text = result.result;
      Logger.debug(`Extracted ${text.length} characters from ${tab.url}`);
      return text;
      
    } catch (error) {
      Logger.error('Text extraction failed:', error);
      throw new Error(`Failed to extract content: ${error.message}`);
    }
  }
  
  /**
   * Function injected into page to extract text
   * This runs in the page context, not the extension context
   */
  static _extractTextFromPage() {
    // Try to find the main content area
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '#content',
      '.post-content',
      '.entry-content',
      '.article-body',
    ];
    
    let contentElement = null;
    
    // Find the best content container
    for (const selector of selectors) {
      contentElement = document.querySelector(selector);
      if (contentElement && contentElement.innerText.trim().length > 200) {
        break;
      }
    }
    
    // Fallback to body if no good content container found
    if (!contentElement || contentElement.innerText.trim().length < 200) {
      contentElement = document.body;
    }
    
    // Extract and clean text
    let text = contentElement.innerText || contentElement.textContent || '';
    
    // Basic cleaning
    text = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
      .trim();
    
    return text;
  }
}

/**
 * OmniFocus Integration Service
 */
class OmniFocusService {
  /**
   * Add a task to OmniFocus
   */
  static async addTask({ title, note, url }) {
    try {
      const encodedTitle = encodeURIComponent(title);
      const encodedNote = encodeURIComponent(note);
      
      const omnifocusUrl = `${CONFIG.omnifocusScheme}?name=${encodedTitle}&note=${encodedNote}`;
      
      Logger.info(`Adding task to OmniFocus: "${title}"`);
      Logger.debug('OmniFocus URL:', omnifocusUrl);
      
      // Create the OmniFocus tab
      const tab = await chrome.tabs.create({
        url: omnifocusUrl,
        active: false,
      });
      
      // Clean up the tab after a delay
      setTimeout(() => {
        chrome.tabs.remove(tab.id).catch((error) => {
          Logger.warn('Failed to cleanup OmniFocus tab:', error.message);
        });
      }, CONFIG.tabCleanupDelay);
      
      Logger.info('Task successfully added to OmniFocus');
      return { success: true };
      
    } catch (error) {
      Logger.error('Failed to add task to OmniFocus:', error);
      throw error;
    }
  }
}

/**
 * Utility function to wrap promises with timeout
 */
async function withTimeout(promise, timeoutMs, errorMessage) {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Main Extension Controller
 */
class ExtensionController {
  constructor() {
    this.aiService = new AIService();
    this.setupMessageHandlers();
    this.setupActionHandlers();
    this.setupCommandHandlers();
  }
  
  /**
   * Initialize the extension
   */
  async initialize() {
    Logger.info('OmniFocus Tab Saver starting...');
    
    // Detect AI capabilities on startup
    await this.aiService.detectCapabilities();
    
    Logger.info('Extension initialized successfully');
  }
  
  /**
   * Add current tab to OmniFocus with optional AI summary
   */
  async addCurrentTab(options = {}) {
    const { includeAISummary = true } = options;
    
    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab || !tab.url) {
        throw new Error('No active tab found');
      }
      
      Logger.info(`Processing tab: ${tab.title}`);
      
      let noteContent = tab.url;
      
      // Generate AI summary if requested and available
      if (includeAISummary && this.aiService.capabilities.ready) {
        try {
          Logger.info('Generating AI summary...');
          
          const pageText = await ContentExtractor.extractText(tab);
          const summary = await withTimeout(
            this.aiService.generateSummary(pageText),
            CONFIG.timeout,
            `AI summarization timed out after ${CONFIG.timeout}ms`
          );
          
          if (summary) {
            noteContent = `${tab.url}\n\n📝 AI Summary:\n${summary}`;
            Logger.info('AI summary generated successfully');
          }
          
        } catch (error) {
          Logger.warn('AI summary generation failed:', error.message);
          // Continue without summary
        }
      }
      
      // Add to OmniFocus
      await OmniFocusService.addTask({
        title: tab.title,
        note: noteContent,
        url: tab.url,
      });
      
      return { success: true, hadAISummary: noteContent.includes('📝 AI Summary:') };
      
    } catch (error) {
      Logger.error('Failed to add tab to OmniFocus:', error);
      throw error;
    }
  }
  
  /**
   * Get extension status information
   */
  async getStatus() {
    if (!this.aiService.initialized) {
      await this.aiService.detectCapabilities();
    }
    
    return {
      aiCapabilities: this.aiService.capabilities,
      config: CONFIG,
    };
  }
  
  /**
   * Setup message handlers for popup communication
   */
  setupMessageHandlers() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const { action, ...options } = message;
      
      Logger.debug('Received message:', action, options);
      
      // Handle different actions
      const handlers = {
        addWithSummary: () => this.addCurrentTab({ includeAISummary: true }),
        addWithoutSummary: () => this.addCurrentTab({ includeAISummary: false }),
        getStatus: () => this.getStatus(),
      };
      
      if (handlers[action]) {
        // Execute handler and send response
        handlers[action]()
          .then((result) => {
            Logger.debug('Action completed successfully:', action, result);
            sendResponse({ success: true, ...result });
          })
          .catch((error) => {
            Logger.error('Action failed:', action, error);
            sendResponse({ 
              success: false, 
              error: error.message || 'Unknown error occurred' 
            });
          });
        
        return true; // Keep message channel open for async response
      }
      
      // Unknown action
      Logger.warn('Unknown action received:', action);
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return false;
    });
  }
  
  /**
   * Setup extension icon click handler
   */
  setupActionHandlers() {
    chrome.action.onClicked.addListener(async (tab) => {
      Logger.debug('Extension icon clicked');
      // The popup will handle the action, this is just for logging
    });
  }
  
  /**
   * Setup keyboard command handlers
   */
  setupCommandHandlers() {
    chrome.commands.onCommand.addListener(async (command) => {
      Logger.debug('Keyboard command received:', command);
      
      try {
        switch (command) {
          case 'addWithSummary':
            await this.addCurrentTab({ includeAISummary: true });
            break;
          case 'addWithoutSummary':
            await this.addCurrentTab({ includeAISummary: false });
            break;
          default:
            Logger.warn('Unknown command:', command);
        }
      } catch (error) {
        Logger.error('Command execution failed:', command, error);
      }
    });
  }
}

// Initialize the extension
const extensionController = new ExtensionController();
extensionController.initialize().catch((error) => {
  Logger.error('Extension initialization failed:', error);
});
