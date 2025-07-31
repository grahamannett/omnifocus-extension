// OmniFocus Tab Saver - Popup Interface
// Modern popup with enhanced UI feedback and status display

class PopupUI {
  constructor() {
    this.elements = {};
    this.currentTab = null;
    this.aiStatus = null;
    
    this.initializeElements();
    this.setupEventListeners();
    this.initialize();
  }
  
  /**
   * Initialize DOM element references
   */
  initializeElements() {
    this.elements = {
      // Status elements
      aiStatus: document.getElementById('aiStatus'),
      aiStatusText: document.getElementById('aiStatusText'),
      
      // Tab info elements
      currentTab: document.getElementById('currentTab'),
      tabTitle: document.getElementById('tabTitle'),
      tabUrl: document.getElementById('tabUrl'),
      
      // Action buttons
      addWithSummary: document.getElementById('addWithSummary'),
      addWithoutSummary: document.getElementById('addWithoutSummary'),
      
      // Feedback elements
      loading: document.getElementById('loading'),
      loadingText: document.getElementById('loadingText'),
      feedback: document.getElementById('feedback'),
      feedbackText: document.getElementById('feedbackText'),
    };
  }
  
  /**
   * Setup event listeners for buttons
   */
  setupEventListeners() {
    this.elements.addWithSummary.addEventListener('click', () => {
      this.handleAddWithSummary();
    });
    
    this.elements.addWithoutSummary.addEventListener('click', () => {
      this.handleAddWithoutSummary();
    });
  }
  
  /**
   * Initialize popup state
   */
  async initialize() {
    try {
      // Get current tab information
      await this.loadCurrentTab();
      
      // Get AI status
      await this.loadAIStatus();
      
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showError('Failed to load extension data');
    }
  }
  
  /**
   * Load current tab information
   */
  async loadCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (tab) {
        this.currentTab = tab;
        this.elements.tabTitle.textContent = tab.title || 'Untitled';
        this.elements.tabUrl.textContent = this.formatUrl(tab.url);
      } else {
        throw new Error('No active tab found');
      }
    } catch (error) {
      this.elements.tabTitle.textContent = 'Error loading tab';
      this.elements.tabUrl.textContent = '';
      throw error;
    }
  }
  
  /**
   * Load AI status from background service
   */
  async loadAIStatus() {
    try {
      const response = await this.sendMessage({ action: 'getStatus' });
      
      if (response.success) {
        this.aiStatus = response.aiCapabilities;
        this.updateAIStatusDisplay();
      } else {
        throw new Error(response.error || 'Failed to get AI status');
      }
    } catch (error) {
      console.error('Failed to load AI status:', error);
      this.updateAIStatusDisplay(false);
    }
  }
  
  /**
   * Update AI status display in UI
   */
  updateAIStatusDisplay(hasError = false) {
    if (hasError || !this.aiStatus) {
      this.elements.aiStatus.className = 'ai-status unknown';
      this.elements.aiStatusText.textContent = 'AI status unknown';
      this.elements.addWithSummary.disabled = true;
      return;
    }
    
    if (this.aiStatus.ready) {
      this.elements.aiStatus.className = 'ai-status ready';
      this.elements.aiStatusText.textContent = 'AI available';
      this.elements.addWithSummary.disabled = false;
    } else {
      this.elements.aiStatus.className = 'ai-status not-ready';
      this.elements.aiStatusText.textContent = 'AI not available';
      this.elements.addWithSummary.disabled = true;
    }
  }
  
  /**
   * Handle adding with AI summary
   */
  async handleAddWithSummary() {
    if (!this.aiStatus?.ready) {
      this.showError('AI summarization is not available');
      return;
    }
    
    await this.performAction('addWithSummary', 'Generating AI summary...');
  }
  
  /**
   * Handle adding without summary
   */
  async handleAddWithoutSummary() {
    await this.performAction('addWithoutSummary', 'Adding to OmniFocus...');
  }
  
  /**
   * Perform the add action with UI feedback
   */
  async performAction(action, loadingMessage) {
    try {
      // Show loading state
      this.showLoading(loadingMessage);
      this.disableButtons();
      
      // Send message to background service
      const response = await this.sendMessage({ action });
      
      if (response.success) {
        const summaryStatus = response.hadAISummary ? ' with AI summary' : '';
        this.showSuccess(`Successfully added to OmniFocus${summaryStatus}!`);
        
        // Close popup after short delay
        setTimeout(() => {
          window.close();
        }, 1500);
      } else {
        throw new Error(response.error || 'Unknown error occurred');
      }
      
    } catch (error) {
      console.error('Action failed:', error);
      this.showError(error.message || 'Failed to add to OmniFocus');
    } finally {
      this.hideLoading();
      this.enableButtons();
    }
  }
  
  /**
   * Send message to background service
   */
  async sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ 
            success: false, 
            error: chrome.runtime.lastError.message 
          });
        } else {
          resolve(response || { success: false, error: 'No response received' });
        }
      });
    });
  }
  
  /**
   * Show loading state
   */
  showLoading(message = 'Processing...') {
    this.elements.loadingText.textContent = message;
    this.elements.loading.classList.add('show');
    this.hideFeedback();
  }
  
  /**
   * Hide loading state
   */
  hideLoading() {
    this.elements.loading.classList.remove('show');
  }
  
  /**
   * Show success message
   */
  showSuccess(message) {
    this.elements.feedbackText.textContent = message;
    this.elements.feedback.className = 'feedback success show';
  }
  
  /**
   * Show error message
   */
  showError(message) {
    this.elements.feedbackText.textContent = message;
    this.elements.feedback.className = 'feedback error show';
  }
  
  /**
   * Hide feedback message
   */
  hideFeedback() {
    this.elements.feedback.classList.remove('show');
  }
  
  /**
   * Disable action buttons
   */
  disableButtons() {
    this.elements.addWithSummary.disabled = true;
    this.elements.addWithoutSummary.disabled = true;
  }
  
  /**
   * Enable action buttons
   */
  enableButtons() {
    this.elements.addWithoutSummary.disabled = false;
    // Only enable AI button if AI is ready
    this.elements.addWithSummary.disabled = !this.aiStatus?.ready;
  }
  
  /**
   * Format URL for display
   */
  formatUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname + urlObj.pathname;
    } catch (error) {
      return url || '';
    }
  }
}

// Global error handler
window.addEventListener('error', (event) => {
  console.error('Popup error:', event.error);
});

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupUI();
});
