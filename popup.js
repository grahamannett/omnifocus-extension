document.addEventListener("DOMContentLoaded", function () {
  const saveButton = document.getElementById("saveToOmniFocus");
  const statusDiv = document.getElementById("status");

  saveButton.addEventListener("click", function () {
    // Instead of handling the logic here, send a message to the background script
    chrome.runtime.sendMessage(
      { action: "addToOmnifocusPopup" },
      function (response) {
        if (response && response.success) {
          statusDiv.textContent = "Added to OmniFocus!";

          setTimeout(() => {
            statusDiv.textContent = "";
            window.close();
          }, 2000);
        } else {
          const errorMsg =
            response && response.error
              ? response.error
              : "Failed to add to OmniFocus";
          statusDiv.textContent = errorMsg;
        }
      }
    );
  });
});
