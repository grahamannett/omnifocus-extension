// This content script will be injected into all pages
// It listens for keyboard events to detect when modifier keys are pressed

// This content script monitors Command key presses to enable/disable popup

// Listen for Command key presses
document.addEventListener("keydown", function (event) {
  if (event.metaKey || event.ctrlKey) {
    chrome.runtime.sendMessage({
      action: "modifierKeyPressedOmniExtension",
      commandKey: true,
    });
  }
});

// Listen for Command key releases
document.addEventListener("keyup", function (event) {
  if (event.key === "Meta" || event.key === "Control") {
    chrome.runtime.sendMessage({ action: "modifierKeyReleasedOmniExtension" });
  }
});
