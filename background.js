const aiAvailable = () => {
  if (!ai || !ai.languageModel || !ai.summarizer || !ai.rewriter)  return false;
  return true;
}


async function getTextContent(tab) {
  const [textResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      // Get main content (prioritize article content or main body text)
      const article = document.querySelector('article') || document.querySelector('main') || document.body;
      return article.innerText.trim();
    }
  });
  return textResult.result;
}

async function getHtmlContent(tab) {
  const [htmlResult] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => document.documentElement.innerHTML
  });
  return htmlResult.result;
}


async function getSummary(longText) {
  /*
  todo: test if better to use:
   -  session = await ai.languageModel.create();
   -  rewriter = await ai.rewriter.create();
  --
  sharedContext: Additional shared context that can help the summarizer.
  type: The type of the summarization, with the allowed values key-points (default), tl;dr, teaser, and headline.
  format: The format of the summarization, with the allowed values markdown (default), and plain-text.
    length: The length of the summarization, with the allowed values short, medium (default), and long. The meanings of these
    lengths vary depending on the type requested. For example, in Chrome's implementation, a short key-points summary consists
    of three bullet points, and a short summary is one sentence; a long key-points summary is seven bullet points, and a long summary is a paragraph.
  */


  const summarizer = await ai.summarizer.create({
    sharedContext: 'Generate a single sentence summary of the following text',
    type: 'headline',
    format: 'markdown',
    length: 'short',
  })
  // optionally add context to summarize:
  //   - summarizer.summarize(longText, {context: 'context string'});
  const summary = await summarizer.summarize(longText);
  return summary

}

// Helper function to check if Chrome AI is available
async function isAIAvailable() {
  if (!ai || !ai.languageModel || !ai.summarizer || !ai.rewriter)  return false;
  return true;
}

// Function to add the current tab to OmniFocus
async function addToOmniFocus(tab) {
  const title = tab.title;
  const url = tab.url;
  let pageText = "";
  let summaryText = "";

  try {
    // Get the page text content
    pageText = await getTextContent(tab);

    if (aiAvailable() && pageText) {
      // Get an AI-generated summary
      summaryText = await getSummary(pageText);
      console.log("summary generated:", summaryText ? "yes" : "no");
    }
  } catch (error) {
    console.error("Error in addToOmniFocus:", error);
  }

  // Create the note content with summary if available
  let noteContent = "";
  if (summaryText) {
    noteContent = `URL: ${url} \n\n Summary: ${summaryText}`;
  } else {
    noteContent = url;
  }

  // Create OmniFocus URL scheme
  const omnifocusUrl = `omnifocus:///add?name=${encodeURIComponent(title)}&note=${encodeURIComponent(noteContent)}`;

  // Create and open the OmniFocus URL
  chrome.tabs.create({ url: omnifocusUrl, active: false }, (newTab) => {
    // Close the newly created tab after a short delay
    setTimeout(() => {
      chrome.tabs.remove(newTab.id);
    }, 500);
  });
}


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
        addToOmniFocus(tabs[0])
          .then(() => sendResponse({success: true}))
          .catch(error => {
            console.error("Error in addToOmniFocus:", error);
            sendResponse({success: false, error: error.message});
          });
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
