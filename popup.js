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

  saveButton.addEventListener("click", function () {
    statusDiv.textContent = "Adding to OmniFocus...";
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupSummary`, response);
        if (response && response.success) {
          statusDiv.textContent = "Added to OmniFocus!";
        } else {
          statusDiv.textContent =
            response?.error || "Failed to add to OmniFocus";
        }
      }
    );
  });

  saveButtonNoSummary.addEventListener("click", function () {
    statusDiv.textContent = "Adding to OmniFocus (no summary)...";
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupNoSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupNoSummary`, response);
        if (response && response.success) {
          statusDiv.textContent = "Added to OmniFocus!";
        } else {
          statusDiv.textContent =
            response?.error || "Failed to add to OmniFocus";
        }
      }
    );
  });
});
