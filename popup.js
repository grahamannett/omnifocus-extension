// Add global error handler
window.onerror = function (message, source, lineno, colno, error) {
  console.error("Error occurred:", message, "at", source, lineno, colno);
  document.body.innerHTML += `<div style="color:red;padding:10px;">Error: ${message}</div>`;
  return true;
};

// Wait for DOM to be fully loaded
document.addEventListener("DOMContentLoaded", function () {
  var saveButton = document.getElementById("saveToOmniFocus");
  var saveButtonNoSummary = document.getElementById("saveToOmniFocusNoSummary");
  var statusDiv = document.getElementById("status");
  var aiStatusDiv = document.getElementById("ai-status");

  // Display AI status information
  function updateAIStatus() {
    chrome.runtime.sendMessage({ action: "getAIStatus" }, function (response) {
      if (response && response.success) {
        const status = response.result;
        let statusText = '';
        let statusColor = '#666';

        if (status.ready) {
          switch (status.type) {
            case 'stable':
              statusText = '✓ AI Ready (Stable API)';
              statusColor = '#0c5';
              break;
            case 'experimental':
              statusText = '✓ AI Ready (Experimental API)';
              statusColor = '#f90';
              break;
            case 'prompt':
              statusText = '✓ AI Ready (Prompt API)';
              statusColor = '#f90';
              break;
            default:
              statusText = '✓ AI Ready';
              statusColor = '#0c5';
          }
        } else {
          statusText = '⚠ AI Not Available';
          statusColor = '#f43';
          // Update button text when AI is not available
          saveButton.innerHTML = `
            <svg class="button-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 5v14"></path>
                <path d="M5 12h14"></path>
            </svg>
            Add to OmniFocus (No AI)
          `;
        }

        aiStatusDiv.innerHTML = `<span style="color: ${statusColor}">${statusText}</span>`;
      } else {
        aiStatusDiv.innerHTML = '<span style="color: #f43">⚠ Status Unknown</span>';
      }
    });
  }

  // Update AI status on popup open
  updateAIStatus();

  // Handle add with AI summary
  saveButton.addEventListener("click", function () {
    statusDiv.innerHTML = '<span style="color: #0c5">Adding to OmniFocus...</span>';
    saveButton.disabled = true;
    saveButtonNoSummary.disabled = true;

    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupSummary`, response);
        
        if (response && response.success) {
          statusDiv.innerHTML = '<span style="color: #0c5">✓ Added to OmniFocus!</span>';
          // Close popup after a short delay
          setTimeout(() => window.close(), 1000);
        } else {
          const errorMsg = response?.error || "Failed to add to OmniFocus";
          statusDiv.innerHTML = `<span style="color: #f43">✗ ${errorMsg}</span>`;
        }
        
        // Re-enable buttons
        saveButton.disabled = false;
        saveButtonNoSummary.disabled = false;
      }
    );
  });

  // Handle add without AI summary
  saveButtonNoSummary.addEventListener("click", function () {
    statusDiv.innerHTML = '<span style="color: #0c5">Adding to OmniFocus (no summary)...</span>';
    saveButton.disabled = true;
    saveButtonNoSummary.disabled = true;

    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupNoSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupNoSummary`, response);
        
        if (response && response.success) {
          statusDiv.innerHTML = '<span style="color: #0c5">✓ Added to OmniFocus!</span>';
          // Close popup after a short delay
          setTimeout(() => window.close(), 1000);
        } else {
          const errorMsg = response?.error || "Failed to add to OmniFocus";
          statusDiv.innerHTML = `<span style="color: #f43">✗ ${errorMsg}</span>`;
        }
        
        // Re-enable buttons
        saveButton.disabled = false;
        saveButtonNoSummary.disabled = false;
      }
    );
  });
});
