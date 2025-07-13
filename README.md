# OmniFocus Extension

![icon](./icons/icon.png)

A browser extension for Chrome-based browsers that adds a button to save the current tab to your OmniFocus inbox. When Chrome AI is available, it automatically includes a one-line summary of the page content using the **stable Summarizer and Language Model Web APIs** introduced in Chrome 124.

While there is another extension that does this: https://github.com/gligoran/save-to-omnifocus
That extension is not the latest manifest version and also leaves a new tab open when the button is clicked.

## Setup

The extension works out-of-the-box on recent Chrome (≥ 124) and other Chromium browsers that expose the `navigator.summarizer` and `navigator.languageModel` APIs.

If you are running an older Canary / Dev build you may still need to enable the corresponding origin trial or the following flags:

- `#summarization-api` – Summarizer API
- `#prompt-api` – Prompt / Language Model API

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

This extension uses the W3C Writing Assist APIs that are now available in stable Chrome builds:

- `navigator.summarizer` for fast extractive summaries
- `navigator.languageModel` for prompt-based generation

At runtime we automatically detect whether these APIs (or the legacy `ai.*` namespace used in the original origin trial) are present. If both APIs are available a short headline-style summary is added to the OmniFocus note; otherwise the extension gracefully falls back to saving only the page URL.

No personal data ever leaves your device – summaries are generated **locally** using the on-device small Gemini model shipped with Chrome.

## Related Docs

- https://inside.omnifocus.com/url-schemes
- Browser API's:
  - https://github.com/webmachinelearning/writing-assistance-apis
  - https://github.com/webmachinelearning/prompt-api/tree/main
