// Popup JavaScript

let currentTab = null;
let aiCapabilities = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab info
  await loadCurrentTab();
  
  // Check AI capabilities
  await checkAICapabilities();
  
  // Set up event listeners
  setupEventListeners();
  
  // Enable buttons
  enableButtons();
});

// Load current tab information
async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    
    // Update UI with tab info
    document.getElementById('tab-title').textContent = tab.title || 'Untitled';
    document.getElementById('tab-url').textContent = tab.url || '';
  } catch (error) {
    console.error('Failed to load current tab:', error);
    showStatus('Failed to load tab information', 'error');
  }
}

// Check AI capabilities
async function checkAICapabilities() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAICapabilities' });
    
    if (response.success) {
      aiCapabilities = response;
      updateAIStatus();
    }
  } catch (error) {
    console.error('Failed to check AI capabilities:', error);
    updateAIStatus(false);
  }
}

// Update AI status indicator
function updateAIStatus(available = null) {
  const indicator = document.getElementById('ai-indicator');
  const statusText = document.getElementById('ai-status-text');
  
  if (available === null && aiCapabilities) {
    available = aiCapabilities.languageModel || aiCapabilities.summarizer;
  }
  
  indicator.classList.remove('checking', 'available', 'unavailable');
  
  if (available === true) {
    indicator.classList.add('available');
    statusText.textContent = 'AI summaries available';
  } else if (available === false) {
    indicator.classList.add('unavailable');
    statusText.textContent = 'AI summaries not available';
  } else {
    indicator.classList.add('checking');
    statusText.textContent = 'Checking AI availability...';
  }
}

// Enable action buttons
function enableButtons() {
  document.getElementById('save-with-summary').disabled = false;
  document.getElementById('save-without-summary').disabled = false;
}

// Disable action buttons
function disableButtons() {
  document.getElementById('save-with-summary').disabled = true;
  document.getElementById('save-without-summary').disabled = true;
}

// Show status message
function showStatus(message, type = 'info') {
  const statusEl = document.getElementById('status-message');
  
  // Clear previous classes
  statusEl.classList.remove('success', 'error', 'loading');
  
  // Add appropriate class
  if (type === 'success') {
    statusEl.classList.add('success');
  } else if (type === 'error') {
    statusEl.classList.add('error');
  } else if (type === 'loading') {
    statusEl.classList.add('loading');
  }
  
  statusEl.textContent = message;
  statusEl.style.display = 'block';
  
  // Auto-hide success messages
  if (type === 'success') {
    setTimeout(() => {
      window.close();
    }, 1500);
  }
}

// Hide status message
function hideStatus() {
  const statusEl = document.getElementById('status-message');
  statusEl.style.display = 'none';
}

// Add to OmniFocus with summary
async function addWithSummary() {
  disableButtons();
  showStatus('Adding to OmniFocus...', 'loading');
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'addToOmniFocus',
      includeSummary: true
    });
    
    if (response.success) {
      const message = response.summaryGenerated 
        ? 'Added to OmniFocus with AI summary!' 
        : 'Added to OmniFocus!';
      showStatus(message, 'success');
    } else {
      throw new Error(response.error || 'Failed to add to OmniFocus');
    }
  } catch (error) {
    console.error('Failed to add to OmniFocus:', error);
    showStatus(error.message || 'Failed to add to OmniFocus', 'error');
    enableButtons();
  }
}

// Add to OmniFocus without summary
async function addWithoutSummary() {
  disableButtons();
  showStatus('Adding to OmniFocus...', 'loading');
  
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'addToOmniFocus',
      includeSummary: false
    });
    
    if (response.success) {
      showStatus('Added to OmniFocus!', 'success');
    } else {
      throw new Error(response.error || 'Failed to add to OmniFocus');
    }
  } catch (error) {
    console.error('Failed to add to OmniFocus:', error);
    showStatus(error.message || 'Failed to add to OmniFocus', 'error');
    enableButtons();
  }
}

// Set up event listeners
function setupEventListeners() {
  // Button clicks
  document.getElementById('save-with-summary').addEventListener('click', addWithSummary);
  document.getElementById('save-without-summary').addEventListener('click', addWithoutSummary);
  
  // Options link
  document.getElementById('options-link').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Alt/Option + Enter for quick add with summary
    if (e.altKey && e.key === 'Enter') {
      e.preventDefault();
      addWithSummary();
    }
    // Ctrl/Cmd + Enter for quick add without summary
    else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      addWithoutSummary();
    }
  });
}
