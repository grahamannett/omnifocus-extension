# OmniFocus Extension

![icon](./icons/icon.png)

A browser extension for Chrome-based browsers that adds a button to save the current tab to your OmniFocus inbox. When Chrome's built-in AI is available, it automatically includes a one-line summary of the page content using the stable Summarizer API.

While there is another extension that does this: https://github.com/gligoran/save-to-omnifocus
That extension is not the latest manifest version and also leaves a new tab open when the button is clicked.

## Features

- **Modern AI Integration**: Uses Chrome's stable built-in AI APIs (Chrome 138+) with automatic fallback to experimental APIs
- **Smart Feature Detection**: Automatically detects and adapts to available AI capabilities
- **Intelligent Summarization**: Generates concise summaries of web pages using Chrome's Summarizer API
- **Clean OmniFocus Integration**: Adds tabs to your OmniFocus inbox without leaving extra tabs open
- **Flexible Usage**: Supports both direct adding and popup interface
- **Keyboard Shortcuts**: Quick task addition with customizable shortcuts
- **Robust Error Handling**: Gracefully handles API unavailability and model download states

## Requirements

### Chrome Version
- **Chrome 138+** (stable) for best experience with built-in AI
- **Chrome 127+** (experimental) for legacy AI API support
- **Any Chrome version** for basic functionality without AI

### For AI Features (Chrome 138+)
- **Operating System**: Windows 10/11, macOS 13+, or Linux
- **Storage**: At least 22 GB available space (for AI model)
- **GPU**: More than 4 GB VRAM
- **Network**: Unlimited or unmetered connection for model download

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension directory

## Usage

### Direct Adding

1. Navigate to a webpage you want to save to OmniFocus
2. Click the OmniFocus Tab Saver extension icon in your browser toolbar
3. The page will be immediately added to your OmniFocus inbox with an AI summary if available

### Using The Popup Interface

1. Navigate to a webpage you want to save to OmniFocus
2. Hold down the Command key (⌘) on Mac or Control key on Windows/Linux
3. While holding the key, click the OmniFocus Tab Saver extension icon
4. In the popup that appears, you can:
   - Click "Add to OmniFocus" to include an AI summary
   - Click "Add without Summary" to add just the title and URL
   - View the current AI status at the top of the popup

### Keyboard Shortcuts

- **Ctrl+Shift+O** (⌘+Shift+O on Mac): Open the extension popup
- **Alt+Shift+O** (⌥+Shift+O on Mac): Add the current tab to OmniFocus with AI summary

## AI Summarization

This extension automatically detects and uses Chrome's built-in AI capabilities:

### Stable API (Chrome 138+)
- **Summarizer API**: Uses Chrome's stable Summarizer API for high-quality summaries
- **Automatic Model Management**: Handles model downloads and updates automatically
- **Multiple Summary Types**: Supports different summary styles (headline, tldr, key-points, teaser)
- **Configurable Length**: Short, medium, or long summaries

### Experimental API (Chrome 127+)
- **Legacy Support**: Maintains compatibility with older experimental APIs
- **Prompt API Fallback**: Uses the Prompt API when Summarizer isn't available

### Fallback Behavior
- **Graceful Degradation**: Works without AI when not available
- **Status Indicators**: Shows AI availability in the popup interface
- **Error Recovery**: Continues operation even if AI summarization fails

## What's New in v0.0.3

- **Modern AI Integration**: Updated to use Chrome's stable built-in AI APIs
- **Better Feature Detection**: Improved detection of available AI capabilities
- **Enhanced Error Handling**: More robust error handling and recovery
- **Improved UI**: Better status indicators and user feedback
- **Automatic Model Management**: Handles AI model downloads seamlessly
- **API Abstraction**: Clean abstraction layer supporting multiple API versions
- **No Setup Required**: No more experimental flags needed for Chrome 138+

## Technical Details

### AI API Abstraction
The extension includes a comprehensive abstraction layer that:
- Detects available AI APIs (stable, experimental, prompt)
- Handles model downloads and progress monitoring
- Provides consistent interface across API versions
- Manages API lifecycle and cleanup

### Content Extraction
- Uses intelligent content extraction to find main article content
- Prioritizes semantic HTML elements (article, main, etc.)
- Cleans and optimizes text for summarization
- Respects minimum content length requirements

### OmniFocus Integration
- Uses OmniFocus URL scheme for seamless integration
- Properly encodes titles and notes
- Automatically closes helper tabs
- Handles errors gracefully

## Browser Compatibility

- **Chrome 138+**: Full functionality with stable AI APIs
- **Chrome 127-137**: Experimental AI API support
- **All Chrome versions**: Basic functionality without AI

## Privacy

- **On-Device Processing**: AI summarization happens entirely on your device
- **No Cloud Requests**: No data sent to external servers for AI processing
- **Local Model Storage**: AI models are stored locally on your device
- **Secure**: Your browsing data never leaves your device

## Troubleshooting

### AI Not Available
- **Check Chrome Version**: Ensure you're using Chrome 138+ for stable AI
- **Verify Storage**: Ensure you have at least 22 GB available storage
- **Check GPU**: Verify your GPU has more than 4 GB VRAM
- **Network**: Ensure you have an unmetered connection for model download

### Model Download Issues
- **Be Patient**: Model download can take several minutes
- **Check Storage**: Ensure sufficient space during download
- **Restart Chrome**: Sometimes helps with download issues

### OmniFocus Integration
- **Install OmniFocus**: Ensure OmniFocus is installed and can handle URL schemes
- **Check Permissions**: Verify the extension has necessary permissions

## Related Documentation

- **Chrome AI Documentation**: https://developer.chrome.com/docs/ai/
- **Summarizer API**: https://developer.chrome.com/docs/ai/summarizer-api
- **OmniFocus URL Schemes**: https://inside.omnifocus.com/url-schemes

## Contributing

Feel free to submit issues and pull requests. The extension is designed to be easily extensible and maintainable.

## License

MIT License - see LICENSE file for details.
