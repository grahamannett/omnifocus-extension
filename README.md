# OmniFocus Extension

![icon](./icons/icon.png)

A browser extension for Chrome-based browsers that adds a button to save the current tab to your OmniFocus inbox. When Chrome AI is available, it automatically includes a one-line summary of the page content.

While there is another extension that does this: https://github.com/gligoran/save-to-omnifocus
That extension is not the latest manifest version and also leaves a new tab open when the button is clicked.

## Setup

1. Use Chrome 138 or later with support for the on-device Summarizer API, and install OmniFocus.
2. Enable Developer mode in `chrome://extensions`, choose **Load unpacked**, and select this directory.
3. Open the extension's Options to configure projects, tags, and theme.

Model availability depends on the browser and device. The first AI request may download the model. See [Chrome's Summarizer guide](https://developer.chrome.com/docs/ai/summarizer-api) for current requirements; selection clipping does not require a model.

## Features

- Adds the current tab's title and URL to your OmniFocus inbox with one click
- Editable popup with project, tags, flag, and due-date controls
- AI-generated page summaries when Chrome's on-device model is available
- Suggests a matching project and tags (click to apply) from your configured lists
- Full-text selection clipping with Quick-save or Edit before saving
- Draggable in-page editor that preserves an existing draft when another capture is requested
- Keyboard shortcuts for opening the popup or saving the active page

## Usage

### Saving A Page

1. Open the extension from the browser toolbar.
2. Review the title, summary/note, and optional task metadata.
3. Choose **Save** to include the note or **Link only** to save only the source URL. Cmd/Ctrl+Enter also saves.
4. The pop-out control opens a fresh editor on an HTTP(S) page; it does not transfer a toolbar draft.

### Clipping A Selection

Select text, then choose **Clip to OmniFocus → Quick-save selection** or **Edit before saving…** from the context menu. Both preserve the entire selection, including whitespace and Unicode, inside quotation marks after the source URL. Selection editors skip AI summarization.

Each selection belongs to its source tab. An already-open editor keeps its draft and refuses a second capture visibly. Handoffs expire after five minutes; a missing capture, closed source, or changed page requires clipping again. Once loaded, a capture keeps its original title and source URL even if focus moves to another tab. Closing the source tab prevents saving from that editor.

Long selection notes are not truncated by the extension. Chrome session-storage and OmniFocus URL-transport limits can still apply.

### Keyboard Shortcuts

- Ctrl+Shift+O (Control+Shift+O on Mac): Open the extension popup
- Alt+Shift+O (Option+Shift+O on Mac): Add the current tab to OmniFocus without opening the popup

## AI Summarization

This extension supports Chrome's AI features to generate a one-line summary of web pages:

- When Chrome AI is available, the extension automatically generates a summary of the current page
- The summary is included in the OmniFocus note field along with the URL
- The popup interface shows whether AI summarization is available
- If AI is not available, the extension falls back to only including the URL

## AI Project & Tag Suggestions

When Chrome's Prompt API (Gemini Nano) is available, the popup also suggests where to file the page:

- On open, it classifies the page against the projects and tags you configure in Settings — running on-device, in parallel with the summary
- Suggestions appear as click-to-apply chips in a "suggest" row; nothing is selected until you click, so the default stays your Inbox
- Output is restricted to your exact project/tag names. If nothing is a strong match, no project is suggested and the task goes to the Inbox
- Toggle it off anytime via Settings → "Suggest project & tags with AI"
- The direct-add shortcut (no popup) always files straight to the Inbox — suggestions are popup-only
- Selection editors skip AI summaries and project/tag suggestions.

## Development

- `mise test` (or `node --test test/`) — regression tests for shared formatting, model-input boundaries, option isolation, background capture/save routing, popup suggestions, lab import races, and offscreen session lifetimes. No Chrome needed.
- **Options → Summary lab** runs text through the real on-device Summarizer with adjustable options. It does not change production defaults. Each lab run creates and destroys its own model session; production reuses a separate instance.
- **Load recent page** imports the most recently used other HTTP(S) page in the lab's window, excluding Options and other extension/internal pages. Editing the input cancels a pending import, and a newer import supersedes an older one. Import errors leave the previous input and source information unchanged.
- Each row records its click-time original input, effective input (at most 8,000 UTF-16 code units), resolved options, timestamp, optional source, result/error, and output character count. Blank optional text fields mean production defaults; the star marks fully resolved default options.
- **Export JSON** downloads `summary-lab-results.json` with `{exportedAt, results}`, including full per-run inputs and provenance rather than the current textarea. Exports can contain private page text and URLs.
- Timing covers creation, inference, messaging, and cleanup, including model download when needed. Lab requests abort after 60 seconds and release their isolated model session; a session acquired after the deadline is also released. Production summaries retain the existing reusable session and background timeout.

## Related Docs

- https://inside.omnifocus.com/url-schemes
- Browser API's:
  - https://github.com/webmachinelearning/writing-assistance-apis
  - https://github.com/webmachinelearning/prompt-api/tree/main

# External Docs

- https://developer.mozilla.org/en-US/docs/Web/API/Summarizer
- https://developer.chrome.com/docs/ai/built-in-apis
- https://developer.chrome.com/docs/ai/summarizer-api
