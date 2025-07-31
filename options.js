// OmniFocus Tab Saver - Options Page
// Basic settings management (foundation for future expansion)

class OptionsManager {
  constructor() {
    this.defaultSettings = {
      aiEnabled: true,
      aiTimeout: 10,
      minTextLength: 100,
      debugEnabled: true,
    };
    
    this.settings = { ...this.defaultSettings };
    this.initialize();
  }
  
  async initialize() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
  }
  
  async loadSettings() {
    try {
      const stored = await chrome.storage.sync.get(this.defaultSettings);
      this.settings = { ...this.defaultSettings, ...stored };
    } catch (error) {
      console.error('Failed to load settings:', error);
      // Use defaults if loading fails
    }
  }
  
  async saveSettings() {
    try {
      await chrome.storage.sync.set(this.settings);
      this.showSaveConfirmation();
    } catch (error) {
      console.error('Failed to save settings:', error);
      this.showSaveError();
    }
  }
  
  setupEventListeners() {
    // Toggle switches
    document.querySelectorAll('.toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const setting = toggle.dataset.setting;
        const isActive = toggle.classList.contains('active');
        
        // Update toggle state
        toggle.classList.toggle('active', !isActive);
        
        // Update settings
        this.settings[setting] = !isActive;
      });
    });
    
    // Number inputs
    document.querySelectorAll('input[type="number"]').forEach(input => {
      input.addEventListener('change', () => {
        const setting = input.dataset.setting;
        const value = parseInt(input.value, 10);
        
        if (!isNaN(value)) {
          this.settings[setting] = value;
        }
      });
    });
    
    // Save button
    document.getElementById('saveSettings').addEventListener('click', () => {
      this.saveSettings();
    });
  }
  
  updateUI() {
    // Update toggles
    document.querySelectorAll('.toggle').forEach(toggle => {
      const setting = toggle.dataset.setting;
      const isEnabled = this.settings[setting];
      toggle.classList.toggle('active', isEnabled);
    });
    
    // Update number inputs
    document.querySelectorAll('input[type="number"]').forEach(input => {
      const setting = input.dataset.setting;
      input.value = this.settings[setting];
    });
  }
  
  showSaveConfirmation() {
    const button = document.getElementById('saveSettings');
    const originalText = button.textContent;
    
    button.textContent = '✓ Settings Saved!';
    button.style.background = 'var(--success)';
    
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = 'var(--primary-color)';
    }, 2000);
  }
  
  showSaveError() {
    const button = document.getElementById('saveSettings');
    const originalText = button.textContent;
    
    button.textContent = '✗ Save Failed';
    button.style.background = 'var(--error)';
    
    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = 'var(--primary-color)';
    }, 2000);
  }
}

// Initialize options when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});