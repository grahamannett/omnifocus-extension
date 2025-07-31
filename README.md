# OmniFocus Tab Saver

![icon](./icons/icon.png)

A modern Chrome extension that saves browser tabs to OmniFocus with AI-powered summaries. Features a clean interface, customizable settings, and keyboard shortcuts for efficient workflow integration.

## Features

- **AI-Powered Summaries**: Automatically generates concise summaries using Chrome's built-in AI (when available)
- **Multiple Summary Types**: Choose between headline, TL;DR, key points, or teaser formats
- **Flexible Options**: Save with or without summaries based on your preference
- **Keyboard Shortcuts**: Quick access via customizable keyboard shortcuts
- **Modern UI**: Clean, responsive interface with visual feedback
- **Configurable Settings**: Customize summary types, lengths, timeouts, and more
- **No Tab Clutter**: Cleanly handles OmniFocus URL scheme without leaving tabs open

## Installation

### From Source

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory

### Chrome AI Setup

To enable AI summaries, you'll need to configure Chrome's experimental AI features:

1. **Enable Chrome AI**:
   - Visit `chrome://flags/#optimization-guide-on-device-model`
   - Set to "Enabled"
   - Restart Chrome

2. **Configure AI APIs**:
   - Enable [Prompt API for Gemini Nano](chrome://flags/#prompt-api-for-gemini-nano)
   - Enable [Summarization API](chrome://flags/#summarization-api-for-gemini-nano)
   - Disable [Text Safety Classifier](chrome://flags/#text-safety-classifier) (it may block content)

3. **Download AI Models**:
   - After enabling flags, Chrome will download the necessary AI models
   - Check the extension's options page to verify AI availability

## Usage

### Adding Tabs to OmniFocus

**Via Extension Icon:**
1. Click the OmniFocus Tab Saver icon in your toolbar
2. Choose "Add to OmniFocus" (with AI summary) or "Quick Add" (without summary)
3. The tab will be added to your OmniFocus inbox

**Via Keyboard Shortcuts:**
- `Ctrl+Shift+O` (Mac: `⌘+Shift+O`): Open extension popup
- `Alt+Shift+O` (Mac: `⌥+Shift+O`): Quick add with AI summary
- `Alt+O` (Mac: `⌥+O`): Quick add without summary

### Customizing Settings

1. Click the extension icon and select "Options"
2. Configure your preferences:
   - **Summary Settings**: Enable/disable AI, choose summary type and length
   - **Advanced Settings**: Adjust timeouts, minimum text length, debug logging
   - **Keyboard Shortcuts**: View current shortcuts (customize in Chrome settings)

## Options

### Summary Types
- **Headline**: Single sentence summary
- **TL;DR**: Brief overview of key points
- **Key Points**: Bullet list of main ideas
- **Teaser**: Preview that entices reading

### Summary Lengths
- **Short**: Concise summaries for quick scanning
- **Medium**: Balanced detail and brevity
- **Long**: More comprehensive summaries

## Technical Details

- Built with Manifest V3
- Uses Chrome's native AI APIs (when available)
- Stores settings in Chrome sync storage
- No external dependencies or API calls
- Privacy-focused: all processing happens locally

## Comparison to Alternatives

Unlike [save-to-omnifocus](https://github.com/gligoran/save-to-omnifocus):
- Uses latest Manifest V3
- Doesn't leave tabs open after saving
- Includes AI-powered summaries
- Modern, customizable interface
- More configuration options

## Related Documentation

- [OmniFocus URL Schemes](https://inside.omnifocus.com/url-schemes)
- [Chrome AI APIs](https://github.com/webmachinelearning/prompt-api)
- [Writing Assistance APIs](https://github.com/webmachinelearning/writing-assistance-apis)

## License

MIT License - feel free to modify and distribute as needed.
