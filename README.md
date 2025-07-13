# OmniFocus Extension

![icon](./icons/icon.png)

A browser extension for Chrome-based browsers that adds a button to save the current tab to your OmniFocus inbox. When Chrome AI is available, it automatically includes a one-line summary of the page content.

## 🎉 New in Version 0.1.0

- **Full support for Chrome 138+ stable AI APIs** - The extension now uses Chrome's built-in Summarizer API
- **Automatic API detection** - Seamlessly switches between stable and experimental APIs
- **Improved UI** - Modern design with real-time AI status indicators
- **Better error handling** - Clear feedback when AI features are unavailable

## Requirements

### Chrome Version
- **Chrome 138 or later** for the stable AI features
- **Chrome 127+** for experimental features (requires flags)

### Hardware Requirements (for AI features)
- **Operating System**: Windows 10/11, macOS 13+, or Linux
- **Storage**: At least 22 GB free space on Chrome profile volume
- **GPU**: More than 4 GB VRAM
- **Network**: Unlimited or unmetered connection

## Setup

### For Chrome 138+ (Recommended)
The AI features should work out of the box! The extension will automatically detect and use the built-in Summarizer API.

### For Older Chrome Versions (Experimental)
If you're using an older version of Chrome, you can still access experimental AI features:

1. Navigate to Chrome flags:
   - `chrome://flags/#text-safety-classifier` - Disable this to prevent blocking
   - `chrome://flags/#optimization-guide-on-device-model` - Enable this
   - `chrome://flags/#prompt-api-for-gemini-nano` - Enable this
   - `chrome://flags/#summarization-api-for-gemini-nano` - Enable this

2. Restart Chrome after enabling the flags

## Features

- ✅ Adds the current tab's title and URL to your OmniFocus inbox with one click
- ✅ Supports both direct adding and popup interface
- ✅ Automatically includes AI-generated summary when Chrome AI is available
- ✅ Command/Ctrl+click to show the popup interface
- ✅ Keyboard shortcuts for quick task addition
- ✅ Cleanly handles OmniFocus URL scheme (no leftover tabs)
- ✅ Real-time AI availability status

## Usage

### Direct Adding

1. Navigate to a webpage you want to save to OmniFocus
2. Click the OmniFocus Tab Saver extension icon in your browser toolbar
3. The page will be immediately added to your OmniFocus inbox with an AI summary if available

### Using The Popup Interface

1. Navigate to a webpage you want to save to OmniFocus
2. Click the OmniFocus Tab Saver extension icon
3. Choose between:
   - **"Add to OmniFocus with Summary"** - Includes an AI-generated summary
   - **"Add without Summary"** - Adds just the title and URL

### Keyboard Shortcuts

- **Ctrl+Shift+O** (Cmd+Shift+O on Mac): Open the extension popup
- **Alt+Shift+O** (Option+Shift+O on Mac): Add the current tab to OmniFocus with AI summary

## AI Summarization

This extension leverages Chrome's built-in AI capabilities:

### Chrome 138+ (Stable API)
- Uses the official Summarizer API
- Supports different summary types (headline, key-points, tldr, teaser)
- Shows download progress if the AI model needs to be downloaded
- Provides clear status indicators

### Older Versions (Experimental)
- Falls back to experimental `window.ai` APIs
- Uses either the summarizer or language model APIs
- Requires enabling Chrome flags

## Architecture

The extension uses a modern abstraction layer (`ai-service.js`) that:
- Automatically detects available AI APIs
- Provides a unified interface for both stable and experimental APIs
- Handles model downloads and initialization
- Gracefully degrades when AI is unavailable

## Development

### Project Structure
```
omnifocus-extension/
├── manifest.json        # Extension configuration
├── background.js        # Background service worker
├── ai-service.js       # AI abstraction layer
├── popup.html          # Popup UI
├── popup.js            # Popup functionality
├── content-script.js   # Content script (currently unused)
├── icons/              # Extension icons
└── README.md          # This file
```

### Building from Source
1. Clone the repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Troubleshooting

### AI Features Not Working?
1. Check Chrome version (138+ recommended)
2. Verify hardware requirements are met
3. Check the popup for AI status indicators
4. For experimental features, ensure flags are enabled

### Model Download Issues
- The AI model download requires a stable internet connection
- Download progress is shown in the extension popup
- The model is approximately 2-3 GB

## Privacy

- All AI processing happens locally on your device
- No data is sent to external servers for summarization
- The extension only accesses the current tab when you activate it

## Related Documentation

- [Chrome AI Summarizer API](https://developer.chrome.com/docs/ai/summarizer-api)
- [OmniFocus URL Schemes](https://inside.omnifocus.com/url-schemes)
- [Chrome Extension Development](https://developer.chrome.com/docs/extensions/)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is provided as-is for personal use. Feel free to modify and distribute according to your needs.
