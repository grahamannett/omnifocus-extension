document.addEventListener("DOMContentLoaded", function () {
  var saveButton = document.getElementById("saveToOmniFocus");
  var saveButtonNoSummary = document.getElementById("saveToOmniFocusNoSummary");
  var statusDiv = document.getElementById("status");

  saveButtonNoSummary.addEventListener("click", function () {
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupNoSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupNoSummary`, response);
      }
    );
  });

  saveButton.addEventListener("click", function () {
    // Instead of handling the logic here, send a message to the background script
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopupSummary" },
      function (response) {
        console.log(`popup.js||addToOmnifocusPopupSummary`, response);
      }
    );
  });
});
