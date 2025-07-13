/**
 * Chrome AI Service Abstraction Layer
 * Provides a unified interface for Chrome's built-in AI capabilities
 * Supports both the experimental APIs and the new stable APIs (Chrome 138+)
 */

class ChromeAIService {
  constructor() {
    this.isInitialized = false;
    this.apiVersion = null;
    this.summarizer = null;
  }

  /**
   * Initialize the AI service and detect available APIs
   */
  async initialize() {
    try {
      // Check for the new stable API (Chrome 138+)
      if ('Summarizer' in self) {
        this.apiVersion = 'stable';
        log.info('Using stable Chrome AI API (Chrome 138+)');
        this.isInitialized = true;
        return true;
      }
      
      // Fall back to experimental APIs
      if (window.ai && (window.ai.languageModel || window.ai.summarizer)) {
        this.apiVersion = 'experimental';
        log.info('Using experimental Chrome AI API');
        this.isInitialized = true;
        return true;
      }

      log.warn('No Chrome AI APIs available');
      return false;
    } catch (error) {
      log.error('Failed to initialize Chrome AI Service:', error);
      return false;
    }
  }

  /**
   * Check if AI features are available
   */
  async checkAvailability() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.apiVersion === 'stable') {
      try {
        const availability = await Summarizer.availability();
        return {
          available: availability === 'available' || availability === 'downloadable',
          status: availability,
          version: 'stable'
        };
      } catch (error) {
        log.error('Error checking stable API availability:', error);
        return { available: false, status: 'error', version: 'stable' };
      }
    }

    if (this.apiVersion === 'experimental') {
      return {
        available: true,
        status: 'available',
        version: 'experimental'
      };
    }

    return { available: false, status: 'unavailable', version: null };
  }

  /**
   * Create or get the summarizer instance
   */
  async getSummarizer(options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.apiVersion === 'stable') {
      // Use the new stable API
      const defaultOptions = {
        sharedContext: 'Generate a concise summary of the following text',
        type: 'headline', // Options: headline, key-points, tldr, teaser
        format: 'plain-text', // Options: markdown, plain-text
        length: 'short' // Options: short, medium, long
      };

      const summarizerOptions = { ...defaultOptions, ...options };

      try {
        const availability = await Summarizer.availability();
        
        if (availability === 'unavailable') {
          throw new Error('Summarizer API is not available');
        }

        // Create summarizer with download progress monitoring
        this.summarizer = await Summarizer.create({
          ...summarizerOptions,
          monitor(m) {
            m.addEventListener('downloadprogress', (e) => {
              log.debug(`Model download progress: ${e.loaded * 100}%`);
            });
          }
        });

        // Wait for the model to be ready if it's downloading
        if (availability === 'downloadable' || availability === 'downloading') {
          await this.summarizer.ready;
        }

        return this.summarizer;
      } catch (error) {
        log.error('Failed to create stable summarizer:', error);
        throw error;
      }
    }

    if (this.apiVersion === 'experimental') {
      // Use the experimental API
      if (window.ai.summarizer) {
        this.summarizer = await window.ai.summarizer.create({
          sharedContext: options.sharedContext || 'Generate a single sentence summary',
          type: options.type || 'headline',
          format: options.format || 'markdown',
          length: options.length || 'short'
        });
        return this.summarizer;
      }
      
      // If no dedicated summarizer, we'll use the language model
      return null;
    }

    throw new Error('No AI APIs available');
  }

  /**
   * Generate a summary of the provided text
   */
  async summarize(text, options = {}) {
    try {
      if (!text || text.length < 50) {
        return 'Text too short to summarize';
      }

      const availability = await this.checkAvailability();
      if (!availability.available) {
        throw new Error('AI features not available');
      }

      // For stable API, use the dedicated summarizer
      if (this.apiVersion === 'stable') {
        const summarizer = await this.getSummarizer(options);
        
        // Use streaming if requested
        if (options.streaming) {
          return await summarizer.summarizeStreaming(text, {
            context: options.context
          });
        }
        
        return await summarizer.summarize(text, {
          context: options.context
        });
      }

      // For experimental API
      if (this.apiVersion === 'experimental') {
        // Try dedicated summarizer first
        if (window.ai.summarizer) {
          const summarizer = await this.getSummarizer(options);
          return await summarizer.summarize(text);
        }
        
        // Fall back to language model
        if (window.ai.languageModel) {
          const session = await window.ai.languageModel.create({
            temperature: 0.7,
            topK: 40,
            systemPrompt: options.systemPrompt || 'Generate a single sentence summary of the following text.'
          });
          
          const result = await session.prompt(text);
          session.destroy();
          return result;
        }
      }

      throw new Error('No summarization method available');
    } catch (error) {
      log.error('Summarization failed:', error);
      throw error;
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.summarizer && this.summarizer.destroy) {
      await this.summarizer.destroy();
    }
    this.summarizer = null;
    this.isInitialized = false;
  }
}

// Create a singleton instance
const chromeAI = new ChromeAIService();

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChromeAIService, chromeAI };
}