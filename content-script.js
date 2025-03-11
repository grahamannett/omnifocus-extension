// This content script will be injected into all pages
// It listens for keyboard events to detect when modifier keys are pressed

// This content script monitors Command key presses to enable/disable popup
// Disabling this for now since I don't like the flow/need for using a content script on every page

// Listen for Command key presses
// document.addEventListener("keydown", (event) => {
//   if (event.metaKey || event.ctrlKey) {
//     chrome.runtime.sendMessage({
//       action: "modifierKeyPressed",
//       commandKey: true,
//     });
//   }
// });

// // Listen for Command key releases
// document.addEventListener("keyup", (event) => {
//   if (event.key === "Meta" || event.key === "Control") {
//     chrome.runtime.sendMessage({ action: "modifierKeyReleased" });
//   }
// });
