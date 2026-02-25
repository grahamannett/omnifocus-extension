# OmniFocus Extension

![icon](./icons/icon.png)

A browser extension for Chrome-based browsers that adds a button to save the current tab to your OmniFocus inbox. When Chrome AI is available, it automatically includes a one-line summary of the page content.

While there is another extension that does this: https://github.com/gligoran/save-to-omnifocus
That extension is not the latest manifest version and also leaves a new tab open when the button is clicked.

## Setup

Some of these features are currently still experimental and may require additional setup in chrome,

- [chrome://flags/#text-safety-classifier](chrome://flags/#text-safety-classifier) - disable this as otherwise everything is blocked
- [Optimization Guide On Device Model](chrome://flags/#optimization-guide-on-device-model) - Enable this
- Enable the following flags:
  - [Prompt API for Gemini Nano](chrome://flags/#prompt-api-for-gemini-nano)
  - [Summarization API](chrome://flags/#summarization-api-for-gemini-nano)

## Features

- Adds the current tab's title and URL to your OmniFocus inbox with one click
- Supports both direct adding and popup interface
- Automatically includes AI-generated summary when Chrome AI is available
- Command/Ctrl+click to show the popup interface
- Keyboard shortcuts for quick task addition
- Cleanly handles OmniFocus URL scheme (no leftover tabs)

## Usage

### Direct Adding

1. Navigate to a webpage you want to save to OmniFocus
2. Click the OmniFocus Tab Saver extension icon in your browser toolbar
3. The page will be immediately added to your OmniFocus inbox with an AI summary if available

### Using The Popup Interface

1. Navigate to a webpage you want to save to OmniFocus
2. Hold down the Command key (⌘) on Mac or Control key on Windows/Linux
3. While holding the key, click the OmniFocus Tab Saver extension icon
4. In the popup that appears, click the "Add to OmniFocus Inbox" button

### Keyboard Shortcuts

- Alt+O (Option+O on Mac): Open the extension popup
- Alt+Shift+O (Option+Shift+O on Mac): Add the current tab to OmniFocus without opening the popup

## AI Summarization

This extension supports Chrome's AI features to generate a one-line summary of web pages:

- When Chrome AI is available, the extension automatically generates a summary of the current page
- The summary is included in the OmniFocus note field along with the URL
- The popup interface shows whether AI summarization is available
- If AI is not available, the extension falls back to only including the URL

## Related Docs

- https://inside.omnifocus.com/url-schemes
- Browser API's:
  - https://github.com/webmachinelearning/writing-assistance-apis
  - https://github.com/webmachinelearning/prompt-api/tree/main

# External Docs

- https://developer.mozilla.org/en-US/docs/Web/API/Summarizer

- https://developer.mozilla.org/en-US/docs/Web/API/Summarizer
- https://developer.chrome.com/docs/ai/built-in-apis
- https://developer.chrome.com/docs/ai/summarizer-api
