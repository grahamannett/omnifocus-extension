const SUMMARIZER_OPTIONS = {
  type: "tldr",
  length: "short",
  format: "plain-text",
  preference: "speed",
  sharedContext: "Generate a single-sentence plain-language summary of the following web page.",
  expectedInputLanguages: ["en"],
  outputLanguage: "en",
}

let summarizerPromise = null

function broadcastProgress(percent) {
  chrome.runtime.sendMessage({ target: "popup", action: "summarizerProgress", percent }).catch(() => {})
}

async function getSummarizer() {
  if (summarizerPromise) return summarizerPromise
  if (!("Summarizer" in self)) {
    throw new Error("Summarizer API unavailable")
  }
  summarizerPromise = (async () => {
    const availability = await Summarizer.availability(SUMMARIZER_OPTIONS)
    if (availability === "unavailable") {
      throw new Error("Summarizer unavailable on this device")
    }
    return Summarizer.create({
      ...SUMMARIZER_OPTIONS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const percent = Math.round((e.loaded ?? 0) * 100)
          console.log(`[offscreen] Summarizer download: ${percent}%`)
          broadcastProgress(percent)
        })
      },
    })
  })().catch((err) => {
    summarizerPromise = null
    throw err
  })
  return summarizerPromise
}

async function getAvailability() {
  if (!("Summarizer" in self)) return "unavailable"
  try {
    return await Summarizer.availability(SUMMARIZER_OPTIONS)
  } catch {
    return "unavailable"
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return

  if (msg.action === "warmup") {
    ;(async () => {
      try {
        const availability = await getAvailability()
        if (availability !== "unavailable") {
          await getSummarizer()
        }
        sendResponse({ ok: true, availability })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }

  if (msg.action === "summarize") {
    ;(async () => {
      try {
        const summarizer = await getSummarizer()
        const summary = await summarizer.summarize(msg.text)
        sendResponse({ ok: true, summary: (summary || "").trim() })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }
})

console.log("[offscreen] loaded")
