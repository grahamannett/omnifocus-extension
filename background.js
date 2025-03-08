// Function to add the current tab to OmniFocus
function addToOmniFocus(tab) {
  const title = tab.title;
  const url = tab.url;

  // Create OmniFocus URL scheme
  const omnifocusUrl = `omnifocus:///add?name=${encodeURIComponent(title)}&note=${encodeURIComponent(url)}`;

  // Create and open the OmniFocus URL
  chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
    // Close the newly created tab after a short delay
    setTimeout(() => {
      chrome.tabs.remove(newTab.id);
    }, 500);
  });
}

// Alternative approach: Use an action.onClicked listener for normal clicks
// and let the popup handle Command+click (since popup takes precedence)

// Set up a dynamic popup URL based on Command key (empty = no popup)
chrome.action.setPopup({ popup: "" }); // Default to no popup (direct add)

// Create a listener for key presses
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'modifierKeyPressed' && message.commandKey) {
    // If Command key is pressed, show the popup
    chrome.action.setPopup({ popup: "popup.html" });
    sendResponse({ success: true });
  } else if (message.action === 'modifierKeyReleased') {
    // When modifier keys are released, reset to direct add mode
    chrome.action.setPopup({ popup: "" });
    sendResponse({ success: true });
  } else if (message.action === 'addToOmniFocus') {
    // Handle add requests from the popup
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs && tabs[0]) {
        addToOmniFocus(tabs[0]);
        sendResponse({success: true});
      } else {
        sendResponse({success: false, error: 'No active tab found'});
      }
    });
    return true; // Required for async sendResponse
  }
});

// Handle direct clicks (when popup is not shown)
chrome.action.onClicked.addListener((tab) => {
  addToOmniFocus(tab);
});

// Listen for keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
  if (command === 'add_to_omnifocus') {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs && tabs[0]) {
        addToOmniFocus(tabs[0]);
      }
    });
  }
});