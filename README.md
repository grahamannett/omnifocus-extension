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

Select text, then choose **Clip to OmniFocus → Quick-save selection** or **Edit before saving…** from the context menu. Both preserve the entire selection, including whitespace and Unicode, inside quotation marks after the source URL. Quick-save saves without AI inference.

**Edit before saving…** automatically suggests projects and tags from the original captured selection when **Suggest project & tags with AI** is enabled and projects or tags are configured. Suggestions remain click-to-apply. The shared **Summary** section identifies its source as **Selection** and waits for you to choose **Summarize**. Review the preview, then choose **Add to note** to prepend it while preserving the full quoted selection and any note edits. Generating a preview alone does not change the note.

Each selection belongs to its source tab. An already-open editor keeps its draft and refuses a second capture visibly. Handoffs expire after five minutes; a missing capture, closed source, or changed page requires clipping again. Once loaded, a capture keeps its original title and source URL even if focus moves to another tab. Closing the source tab prevents saving from that editor.

Selection AI requires at least 50 characters of text. Suggestions use at most 4,000 UTF-16 code units and summaries use at most 8,000; the saved quote is not truncated. Chrome session-storage and OmniFocus URL-transport limits can still apply to long notes.

### Keyboard Shortcuts

- Ctrl+Shift+O (Control+Shift+O on Mac): Open the extension popup
- Alt+Shift+O (Option+Shift+O on Mac): Add the current tab to OmniFocus without opening the popup

## AI Summarization

The toolbar popup and selection editor use the same **Summary** section, with **Page** or **Selection** shown as the source. Both show loading progress, a summary preview, and any generation error separately from the editable note.

- Opening the toolbar popup automatically starts its first page summary. It fills the note only if you have not edited the note while it runs.
- Selection editors keep the full quoted selection in the note and generate a summary only when you choose **Summarize**.
- After a result, **Summarize** becomes **Regenerate summary**. Manual generation updates the preview; review it before applying it to the note.
- **Add to note** prepends the preview to the existing note. If an earlier generated summary remains intact at the start of the note, **Replace summary** updates only that prefix, preserving the full quoted selection and any manual text after it. Editing that generated prefix changes the action back to **Add to note**.
- Generation errors leave the existing note unchanged. You can still save the note or choose **Link only**.
- **Save** includes the current note and source URL. Quick-save selection continues to save the complete quote without AI inference.

## AI Project & Tag Suggestions

When Chrome's Prompt API (Gemini Nano) is available, the editor also suggests where to file the page or selection:

- On open, it classifies the page against the projects and tags you configure in Settings — running on-device, in parallel with the summary
- Selection editors classify the original captured text against the same configured projects and tags
- Suggestions appear as click-to-apply chips in a "suggest" row; nothing is selected until you click, so the default stays your Inbox
- The suggest row shows when AI is working, when it finds no matches, or why suggestions are unavailable. It also explains when suggestions are disabled, no projects/tags are configured, or the text is too short.
- Output is restricted to your exact project/tag names. If nothing is a strong match, no project is suggested and the task goes to the Inbox
- Toggle it off anytime via Settings → "Suggest project & tags with AI"
- The direct-add shortcut (no popup) always files straight to the Inbox — suggestions are popup-only
- Quick-save selection does not request summaries or project/tag suggestions.

## Development

- `mise test` (or `node --test test/`) — regression tests for shared formatting, model-input boundaries, option isolation, background capture/save routing, popup suggestions, lab import races, and offscreen session lifetimes. No Chrome needed.
- **Options → Summary lab** runs text through the real on-device Summarizer with adjustable options. It does not change production defaults. Each lab run creates and destroys its own model session; production reuses a separate instance.
- **Load recent page** imports the most recently used other HTTP(S) page in the lab's window, excluding Options and other extension/internal pages. Editing the input cancels a pending import, and a newer import supersedes an older one. Import errors leave the previous input and source information unchanged.
- Each row records its click-time original input, effective input (at most 8,000 UTF-16 code units), resolved options, timestamp, optional source, result/error, and output character count. Blank optional text fields mean production defaults; the star marks fully resolved default options.
- **Export JSON** downloads `summary-lab-results.json` with `{exportedAt, results}`, including full per-run inputs and provenance rather than the current textarea. Exports can contain private page text and URLs.
- Timing covers creation, inference, messaging, and cleanup, including model download when needed. Selection summaries and lab runs abort after 60 seconds and release their isolated model session; a session acquired after the deadline is also released. Page summaries retain their reusable session and background timeout.

### Chrome error smoke check

Run `node --test test/context-menus.test.js test/offscreen.test.js` for the targeted regressions, then check the real Chrome APIs:

1. Open the extension's **Errors** page from `chrome://extensions` and clear all historical errors before testing.
2. Reload the unpacked extension three times from `chrome://extensions` and confirm version **0.0.4**. After each reload, select text on a web page and confirm **Clip to OmniFocus** contains **Quick-save selection** and **Edit before saving…** once each. Check the Errors page for new duplicate-ID errors.
3. In Options, enable **Suggest project & tags with AI** and configure at least one project or tag. Open an HTTP(S) article with several paragraphs of text, then open the extension from the toolbar and wait for AI processing. Close and reopen the popup to exercise the cached classifier. **Edit before saving…** also exercises the classifier using the captured selection when it has at least 50 characters; Summary lab does not. No task needs to be saved.
4. Check the Errors page again for the **No output language was specified** warning. An empty suggestion row alone does not establish that classification succeeded; use the direct probe below to confirm inference.
5. Restart Chrome and repeat the selection-menu and toolbar-popup checks to cover browser startup and worker reuse.

For a direct classifier check, click the extension's **service worker → Inspect** link in `chrome://extensions` and run this in its Console:

```js
await classifyViaOffscreen("An article about organizing a reading list and saving interesting web pages for later.", {
  title: "Reading list",
  url: "https://example.com/",
  projects: ["Reading"],
  tags: ["Article"],
})
```

This uses the real on-device model without changing settings or saving a task. A resolved `{ project, tags }` result, including empty choices, with no new output-language warning passes the language check. If the model is unavailable or the call throws, the language path has not been verified.

## Related Docs

- https://inside.omnifocus.com/url-schemes
- Browser API's:
  - https://github.com/webmachinelearning/writing-assistance-apis
  - https://github.com/webmachinelearning/prompt-api/tree/main

# External Docs

- https://developer.mozilla.org/en-US/docs/Web/API/Summarizer
- https://developer.chrome.com/docs/ai/built-in-apis
- https://developer.chrome.com/docs/ai/summarizer-api
