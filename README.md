# OmniFocus Extension

![icon](./icons/icon.png)

A completely rewritten browser extension for Chrome-based browsers that saves web pages to your OmniFocus inbox with AI-powered summaries using Chrome's built-in AI capabilities.

## ✨ What's New in v1.0.0

**Complete Rewrite**: This extension has been completely rewritten from the ground up with:

- 🤖 **Proper AI Integration** - Async detection and usage of Chrome's AI APIs
- 🎨 **Modern UI** - Beautiful, intuitive popup with real-time status indicators
- 🛠️ **Robust Architecture** - Class-based design with comprehensive error handling
- ⚙️ **Settings Page** - Configurable options for timeouts, AI preferences, and more
- 🚀 **Enhanced Performance** - Better text extraction and processing
- 📝 **Comprehensive Logging** - Debug tools for troubleshooting
- ⌨️ **Keyboard Shortcuts** - Quick access without opening popup

## Setup

### Chrome AI Setup (Required for AI Features)

Some Chrome AI features are currently experimental and require setup:

1. **Enable Chrome Flags** (visit these URLs in Chrome):
   - [chrome://flags/#text-safety-classifier](chrome://flags/#text-safety-classifier) - **Disable** this
   - [chrome://flags/#optimization-guide-on-device-model](chrome://flags/#optimization-guide-on-device-model) - **Enable** this
   - [chrome://flags/#prompt-api-for-gemini-nano](chrome://flags/#prompt-api-for-gemini-nano) - **Enable** this
   - [chrome://flags/#summarization-api-for-gemini-nano](chrome://flags/#summarization-api-for-gemini-nano) - **Enable** this

2. **Restart Chrome** after enabling these flags
3. Visit a few websites to trigger the AI model download (this happens automatically in the background)

### Extension Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension directory
5. The extension icon should appear in your toolbar

## Features

### 🎯 Core Functionality

- **One-Click Save**: Click the extension icon to save the current page
- **AI Summaries**: Automatically generates concise, single-sentence summaries
- **Smart Text Extraction**: Intelligently finds and extracts main content from pages
- **Clean Integration**: Uses OmniFocus URL scheme with automatic tab cleanup

### 🎨 Modern Interface

- **Real-time AI Status**: Shows whether Chrome AI is available
- **Current Tab Display**: Preview of what will be saved
- **Loading States**: Visual feedback during processing
- **Success/Error Messages**: Clear feedback on all operations

### ⌨️ Keyboard Shortcuts

- **Alt+Shift+O**: Add current tab with AI summary
- **Alt+O**: Add current tab without summary

### ⚙️ Customizable Settings

Access via right-click on extension icon → Options:

- AI summarization toggle
- Summary timeout settings
- Minimum text length for summarization
- Debug logging controls

## Usage

### Quick Save (Recommended)

1. Navigate to any webpage
2. Press **Alt+Shift+O** for AI summary or **Alt+O** for basic save
3. Page is automatically added to OmniFocus with summary (if AI available)

### Using the Popup

1. Navigate to a webpage you want to save
2. Click the OmniFocus extension icon
3. View the AI status indicator:
   - 🟢 **Green**: AI available - summaries will be generated
   - 🟡 **Yellow**: AI not available - basic save only
   - ⚪ **Gray**: Checking AI status
4. Choose your save option:
   - **"Add with AI Summary"**: Generates and includes page summary
   - **"Add without Summary"**: Saves just title and URL

## AI Summarization

The extension leverages Chrome's built-in AI to create intelligent summaries:

- **Automatic Detection**: Checks AI availability on each use
- **Smart Fallback**: Works with or without AI - never blocks basic functionality
- **Quality Control**: Only summarizes pages with sufficient content
- **Timeout Protection**: Won't hang if AI takes too long
- **Resource Cleanup**: Properly manages AI sessions to avoid memory leaks

### Summary Format

When AI is available, saved items include:
```
https://example.com/article

📝 AI Summary:
A concise, single-sentence summary of the main page content focusing on key information.
```

## Troubleshooting

### AI Not Available

If AI features aren't working:

1. **Check Chrome Flags**: Ensure all required flags are enabled (see Setup)
2. **Restart Chrome**: Required after changing flags
3. **Wait for Model Download**: AI models download automatically but may take time
4. **Check Extension Console**: Look for errors in the extension's background page
5. **Try Different Pages**: Some pages may not have enough content for summarization

### Debug Mode

Enable debug logging in the extension options to see detailed information:

1. Right-click extension icon → Options
2. Enable "Debug Logging"
3. Open Chrome DevTools → Console to view logs
4. Look for messages prefixed with timestamps and log levels

### Common Issues

- **"No active tab found"**: Refresh the page and try again
- **"Text too short"**: Page doesn't have enough content for AI summary
- **"AI services not available"**: Chrome AI not properly enabled or loaded
- **"Failed to extract content"**: Page structure prevents content extraction

## Architecture

The extension uses a modern, class-based architecture:

- **ExtensionController**: Main orchestrator and message handler
- **AIService**: Manages Chrome AI capabilities and summarization
- **ContentExtractor**: Handles intelligent text extraction from web pages
- **OmniFocusService**: Manages OmniFocus URL scheme integration
- **PopupUI**: Modern popup interface with real-time feedback

## Future Enhancements

The extension is designed for easy expansion. Proposed features include:

- 🏷️ **Smart Tag Extraction** - Auto-detect and suggest tags from content
- 📁 **Project Selection** - Choose specific OmniFocus projects/folders
- 📝 **Custom Templates** - User-defined task templates
- 🔗 **Batch Processing** - Save multiple tabs at once
- 📋 **Summary Editing** - Edit summaries before saving
- 🌙 **Dark Mode** - Automatic theme detection
- 🔄 **Multi-App Support** - Integration with other task managers

## Related Documentation

- [OmniFocus URL Schemes](https://inside.omnifocus.com/url-schemes)
- [Chrome AI APIs](https://github.com/webmachinelearning/prompt-api)
- [Chrome Extensions Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)

## Development

### Project Structure
```
omnifocus-extension/
├── manifest.json          # Extension configuration
├── background.js           # Service worker (main logic)
├── popup.html             # Popup interface
├── popup.js               # Popup functionality
├── options.html           # Settings page
├── options.js             # Settings functionality
├── icons/                 # Extension icons
└── README.md              # This file
```

### Testing

1. **Load Extension**: Follow installation steps above
2. **Test AI Detection**: Check popup shows correct AI status
3. **Test Basic Save**: Use "Add without Summary" on various pages
4. **Test AI Summary**: Use "Add with AI Summary" on content-rich pages
5. **Test Keyboard Shortcuts**: Verify both Alt+O and Alt+Shift+O work
6. **Test Settings**: Access options page and modify settings
7. **Test Error Handling**: Try on pages with minimal content or connection issues

### Building for Production

The extension is ready to use as-is. For distribution:

1. Test thoroughly across different websites
2. Update version in `manifest.json`
3. Create a zip file of all extension files
4. Submit to Chrome Web Store (if desired)

---

Built with ❤️ for productivity enthusiasts using OmniFocus and Chrome's cutting-edge AI capabilities.
