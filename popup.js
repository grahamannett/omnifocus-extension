// Add global error handler
window.onerror = function (message, source, lineno, colno, error) {
  console.error("Error occurred:", message, "at", source, lineno, colno);
  const statusDiv = document.getElementById("status");
  if (statusDiv) {
    statusDiv.textContent = `Error: ${message}`;
    statusDiv.className = "status error";
  }
  return true;
};

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", async function () {
  const saveButton = document.getElementById("saveToOmniFocus");
  const saveButtonNoSummary = document.getElementById("saveToOmniFocusNoSummary");
  const statusDiv = document.getElementById("status");
  const aiStatusDiv = document.getElementById("aiStatus");
  
  // Check AI availability
  try {
    const response = await chrome.runtime.sendMessage({ action: "checkAIAvailability" });
    
    if (response && response.success && response.data) {
      const aiStatus = response.data;
      const aiStatusIcon = aiStatusDiv.querySelector('.ai-status-icon');
      const aiStatusText = aiStatusDiv.querySelector('span');
      
      // Remove loading animation
      aiStatusIcon.classList.remove('loading');
      
      if (aiStatus.available) {
        aiStatusDiv.className = 'ai-status available';
        aiStatusIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />';
        aiStatusText.textContent = `AI ready (${aiStatus.version === 'stable' ? 'Chrome 138+' : 'Experimental'})`;
        saveButton.disabled = false;
      } else if (aiStatus.status === 'downloadable' || aiStatus.status === 'downloading') {
        aiStatusDiv.className = 'ai-status downloading';
        aiStatusIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />';
        aiStatusText.textContent = 'AI model downloading...';
        saveButton.disabled = false;
      } else {
        aiStatusDiv.className = 'ai-status unavailable';
        aiStatusIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
        aiStatusText.textContent = 'AI not available';
        saveButton.disabled = true;
      }
    } else {
      // AI check failed
      aiStatusDiv.className = 'ai-status unavailable';
      const aiStatusIcon = aiStatusDiv.querySelector('.ai-status-icon');
      aiStatusIcon.classList.remove('loading');
      aiStatusIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
      aiStatusDiv.querySelector('span').textContent = 'AI not available';
      saveButton.disabled = true;
    }
  } catch (error) {
    console.error('Failed to check AI availability:', error);
    aiStatusDiv.className = 'ai-status unavailable';
    const aiStatusIcon = aiStatusDiv.querySelector('.ai-status-icon');
    aiStatusIcon.classList.remove('loading');
    aiStatusDiv.querySelector('span').textContent = 'AI check failed';
    saveButton.disabled = true;
  }

  // Add to OmniFocus with summary
  saveButton.addEventListener("click", function () {
    statusDiv.textContent = "Adding to OmniFocus...";
    statusDiv.className = "status";
    saveButton.disabled = true;
    saveButtonNoSummary.disabled = true;
    
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupSummary`, response);
        if (response && response.success) {
          statusDiv.textContent = "✓ Added to OmniFocus!";
          statusDiv.className = "status success";
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          statusDiv.textContent = response?.error || "Failed to add to OmniFocus";
          statusDiv.className = "status error";
          saveButton.disabled = false;
          saveButtonNoSummary.disabled = false;
        }
      }
    );
  });

  // Add to OmniFocus without summary
  saveButtonNoSummary.addEventListener("click", function () {
    statusDiv.textContent = "Adding to OmniFocus...";
    statusDiv.className = "status";
    saveButton.disabled = true;
    saveButtonNoSummary.disabled = true;
    
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupNoSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupNoSummary`, response);
        if (response && response.success) {
          statusDiv.textContent = "✓ Added to OmniFocus!";
          statusDiv.className = "status success";
          setTimeout(() => {
            window.close();
          }, 1500);
        } else {
          statusDiv.textContent = response?.error || "Failed to add to OmniFocus";
          statusDiv.className = "status error";
          saveButton.disabled = false;
          saveButtonNoSummary.disabled = false;
        }
      }
    );
  });
});
