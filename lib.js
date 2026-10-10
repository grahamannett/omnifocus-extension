// Pure, dependency-free helpers shared by background, popup, lab and offscreen
// (loaded via importScripts / <script>) and by Node regression tests
// (via require). No chrome.* APIs in here — keep it that way.
;(function (root) {
  const SUMMARY_MIN_TEXT_LEN = 50
  const SUMMARY_MAX_TEXT_LEN = 8000

  const SUMMARIZER_DEFAULTS = Object.freeze({
    type: "tldr",
    length: "short",
    format: "plain-text",
    preference: "speed",
    sharedContext: "Generate a single-sentence plain-language summary of the following web page.",
    expectedInputLanguages: Object.freeze(["en"]),
    outputLanguage: "en",
  })

  // Validate + truncate page text before sending it to the model.
  // Throws "text too short" — same contract background.js has always had.
  function prepareText(text) {
    if (!text || text.length < SUMMARY_MIN_TEXT_LEN) {
      throw new Error("text too short")
    }
    return text.length > SUMMARY_MAX_TEXT_LEN ? text.slice(0, SUMMARY_MAX_TEXT_LEN) : text
  }

  // Defaults merged with caller overrides. Always returns a fresh object —
  // mutating the result never affects future calls.
  function buildSummarizerOptions(overrides) {
    const options = { ...SUMMARIZER_DEFAULTS, ...(overrides || {}) }
    for (const key of Object.keys(options)) {
      if (Array.isArray(options[key])) options[key] = options[key].slice()
    }
    return options
  }

  function normalizeSummary(summary) {
    return (summary || "").trim()
  }

  function buildOmnifocusUrl({ name, note, project, tags, flag, due }) {
    // Manual encoding (not URLSearchParams) because OmniFocus's URL parser treats
    // `+` as a literal character; we need spaces encoded as %20 (RFC 3986).
    const enc = encodeURIComponent
    const parts = [`name=${enc(name || "")}`, `note=${enc(note || "")}`]
    if (project) parts.push(`project=${enc(project)}`)
    if (tags && tags.length) parts.push(`tags=${enc(tags.join(","))}`)
    if (flag) parts.push("flag=true")
    if (due) parts.push(`due=${enc(due)}`)
    return `omnifocus:///add?${parts.join("&")}`
  }

  function quoteSelection(text) {
    return text && text.trim() ? `“${text}”` : ""
  }

  function buildNote(url, body) {
    const note = (body || "").trim()
    return url && note ? `${url}\n\n${note}` : url || note
  }

  const api = {
    SUMMARY_MIN_TEXT_LEN,
    SUMMARY_MAX_TEXT_LEN,
    SUMMARIZER_DEFAULTS,
    prepareText,
    buildSummarizerOptions,
    normalizeSummary,
    buildOmnifocusUrl,
    quoteSelection,
    buildNote,
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api
  } else {
    root.Lib = api
  }
})(typeof self !== "undefined" ? self : globalThis)
