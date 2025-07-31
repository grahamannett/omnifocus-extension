// Options page JavaScript

// Default settings (should match background.js)
const DEFAULT_SETTINGS = {
  summaryEnabled: true,
  summaryType: 'headline',
  summaryLength: 'short',
  timeout: 7000,
  debug: false,
  minTextLength: 50
};

// Load and display current settings
async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    
    // Update form fields
    document.getElementById('summaryEnabled').checked = settings.summaryEnabled;
    document.getElementById('summaryType').value = settings.summaryType;
    document.getElementById('summaryLength').value = settings.summaryLength;
    document.getElementById('timeout').value = settings.timeout;
    document.getElementById('minTextLength').value = settings.minTextLength;
    document.getElementById('debug').checked = settings.debug;
    
    console.log('Settings loaded:', settings);
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

// Save settings
async function saveSettings() {
  const settings = {
    summaryEnabled: document.getElementById('summaryEnabled').checked,
    summaryType: document.getElementById('summaryType').value,
    summaryLength: document.getElementById('summaryLength').value,
    timeout: parseInt(document.getElementById('timeout').value),
    minTextLength: parseInt(document.getElementById('minTextLength').value),
    debug: document.getElementById('debug').checked
  };
  
  try {
    await chrome.storage.sync.set(settings);
    
    // Show save confirmation
    const statusEl = document.getElementById('save-status');
    statusEl.style.display = 'block';
    
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 2000);
    
    console.log('Settings saved:', settings);
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// Reset to defaults
async function resetSettings() {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    try {
      await chrome.storage.sync.clear();
      await chrome.storage.sync.set(DEFAULT_SETTINGS);
      await loadSettings();
      
      // Show save confirmation
      const statusEl = document.getElementById('save-status');
      statusEl.textContent = 'Settings reset!';
      statusEl.style.display = 'block';
      
      setTimeout(() => {
        statusEl.style.display = 'none';
        statusEl.textContent = 'Settings saved!';
      }, 2000);
    } catch (error) {
      console.error('Failed to reset settings:', error);
    }
  }
}

// Check AI capabilities
async function checkAICapabilities() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getAICapabilities' });
    
    if (response.success) {
      const caps = response;
      
      // Update AI availability
      updateStatusIndicator('ai-available', caps.available);
      document.getElementById('ai-available-text').textContent = 
        caps.available ? 'Available' : (caps.error || 'Not available');
      
      // Update language model
      updateStatusIndicator('language-model', caps.languageModel);
      document.getElementById('language-model-text').textContent = 
        caps.languageModel ? 'Ready' : 'Not available';
      
      // Update summarizer
      updateStatusIndicator('summarizer', caps.summarizer);
      document.getElementById('summarizer-text').textContent = 
        caps.summarizer ? 'Ready' : 'Not available';
    }
  } catch (error) {
    console.error('Failed to check AI capabilities:', error);
    
    // Update all indicators to show error
    updateStatusIndicator('ai-available', false);
    updateStatusIndicator('language-model', false);
    updateStatusIndicator('summarizer', false);
    
    document.getElementById('ai-available-text').textContent = 'Error checking';
    document.getElementById('language-model-text').textContent = 'Error checking';
    document.getElementById('summarizer-text').textContent = 'Error checking';
  }
}

// Update status indicator UI
function updateStatusIndicator(id, isAvailable) {
  const indicator = document.getElementById(`${id}-indicator`);
  if (isAvailable) {
    indicator.classList.add('available');
    indicator.classList.remove('unavailable');
  } else {
    indicator.classList.add('unavailable');
    indicator.classList.remove('available');
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Load current settings
  loadSettings();
  
  // Check AI capabilities
  checkAICapabilities();
  
  // Set up event listeners
  document.getElementById('save-button').addEventListener('click', saveSettings);
  document.getElementById('reset-button').addEventListener('click', resetSettings);
  
  // Auto-save on change (optional)
  const inputs = document.querySelectorAll('input, select');
  inputs.forEach(input => {
    input.addEventListener('change', () => {
      // You could auto-save here if desired
      // saveSettings();
    });
  });
});