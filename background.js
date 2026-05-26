const SUMMARY_TIMEOUT_MS = 60000
const MIN_TEXT_LEN = 50
const MAX_TEXT_LEN = 8000
const MAX_CLASSIFY_LEN = 4000
const OFFSCREEN_URL = "offscreen.html"
const _PRE = "of-ext"

const log = {
  info: (...a) => console.log(`[${_PRE}]`, ...a),
  warn: (...a) => console.warn(`[${_PRE}]`, ...a),
  error: (...a) => console.error(`[${_PRE}]`, ...a),
}

async function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function getTabText(tab) {
  const [r] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const root = document.querySelector("article") || document.querySelector("main") || document.body
      return root ? root.innerText.trim() : ""
    },
  })
  return r?.result ?? ""
}

let creatingOffscreen = null
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return
  if (creatingOffscreen) return creatingOffscreen
  creatingOffscreen = chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ["DOM_PARSER"],
      justification: "Run Chrome's Summarizer API which requires a DOM context.",
    })
    .catch((err) => {
      if (/single offscreen document/i.test(err?.message || "")) return
      throw err
    })
  try {
    await creatingOffscreen
  } finally {
    creatingOffscreen = null
  }
}

async function summarizeViaOffscreen(text) {
  if (!text || text.length < MIN_TEXT_LEN) {
    throw new Error("text too short")
  }
  const truncated = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text
  await ensureOffscreen()
  const resp = await chrome.runtime.sendMessage({
    target: "offscreen",
    action: "summarize",
    text: truncated,
  })
  if (!resp?.ok) throw new Error(resp?.error || "summarize failed")
  return resp.summary || ""
}

async function classifyViaOffscreen(text, meta) {
  await ensureOffscreen()
  const resp = await chrome.runtime.sendMessage({
    target: "offscreen",
    action: "classify",
    text,
    title: meta.title,
    url: meta.url,
    projects: meta.projects,
    tags: meta.tags,
  })
  if (!resp?.ok) throw new Error(resp?.error || "classify failed")
  return { project: resp.project || "", tags: Array.isArray(resp.tags) ? resp.tags : [] }
}

async function warmupSummarizer() {
  try {
    await ensureOffscreen()
    const resp = await chrome.runtime.sendMessage({
      target: "offscreen",
      action: "warmup",
    })
    log.info("warmup:", resp)
    return resp
  } catch (err) {
    log.warn("warmup failed:", err.message)
    return { ok: false, error: err.message }
  }
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

async function summarizeTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const text = await getTabText(tab)
  return withTimeout(summarizeViaOffscreen(text), SUMMARY_TIMEOUT_MS, "summarize")
}

async function suggestMetaForTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const { projects = [], tags = [] } = await chrome.storage.sync.get(["projects", "tags"])
  // Nothing configured to suggest from → straight to Inbox, no inference.
  if (!projects.length && !tags.length) return { project: "", tags: [] }

  const text = await getTabText(tab)
  if (!text || text.length < MIN_TEXT_LEN) return { project: "", tags: [] }
  const truncated = text.length > MAX_CLASSIFY_LEN ? text.slice(0, MAX_CLASSIFY_LEN) : text

  return withTimeout(
    classifyViaOffscreen(truncated, { title: tab.title || "", url: tab.url || "", projects, tags }),
    SUMMARY_TIMEOUT_MS,
    "classify",
  )
}

async function addToOmniFocus(tab, opts) {
  if (!tab?.url) throw new Error("No active tab")
  const { llmEnabled, customTitle, customNote, project, tags, flag, due } = opts
  log.info("addToOmniFocus", { url: tab.url, llmEnabled, project, tags, flag, due, hasCustomNote: customNote != null })

  const name = customTitle != null && customTitle.length > 0 ? customTitle : tab.title || ""

  let note
  let summarySkipped = false
  let skipReason = null

  if (customNote != null) {
    // Popup pre-built the note; trust it.
    note = customNote
  } else {
    note = tab.url
    if (llmEnabled) {
      try {
        const summary = await summarizeTab(tab.id)
        if (summary) {
          note = `${tab.url}\n\n${summary}`
        } else {
          summarySkipped = true
          skipReason = "empty summary"
        }
      } catch (err) {
        summarySkipped = true
        skipReason = err.message
        log.warn("summary skipped:", err.message)
      }
    }
  }

  const url = buildOmnifocusUrl({ name, note, project, tags, flag, due })

  log.info("opening omnifocus URL:", url)
  const newTab = await chrome.tabs.create({ url, active: true })
  log.info("opened tab", newTab.id)
  log.info("done")

  return { summarySkipped, skipReason }
}

async function handleSave(opts) {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  })
  if (!tab) throw new Error("No active tab")
  return addToOmniFocus(tab, opts)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ignore messages destined for other endpoints.
  if (msg?.target === "offscreen" || msg?.target === "popup") return

  if (msg?.action === "addToOmnifocus") {
    handleSave({
      llmEnabled: !!msg.llmEnabled,
      customTitle: typeof msg.customTitle === "string" ? msg.customTitle : null,
      customNote: typeof msg.customNote === "string" ? msg.customNote : null,
      project: msg.project ?? null,
      tags: Array.isArray(msg.tags) ? msg.tags : [],
      flag: !!msg.flag,
      due: msg.due ?? null,
    })
      .then(({ summarySkipped, skipReason }) => sendResponse({ success: true, summarySkipped, reason: skipReason }))
      .catch((err) => {
        log.error(err)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (msg?.action === "summarize") {
    const tabId = msg.tabId
    if (!tabId) {
      sendResponse({ success: false, error: "no tabId" })
      return false
    }
    summarizeTab(tabId)
      .then((summary) => sendResponse({ success: true, summary: summary || "" }))
      .catch((err) => {
        log.warn("summarize failed:", err.message)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (msg?.action === "suggestMeta") {
    const tabId = msg.tabId
    if (!tabId) {
      sendResponse({ success: false, error: "no tabId" })
      return false
    }
    suggestMetaForTab(tabId)
      .then(({ project, tags }) => sendResponse({ success: true, project, tags }))
      .catch((err) => {
        log.warn("suggestMeta failed:", err.message)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (msg?.action === "checkAvailability") {
    warmupSummarizer()
      .then((resp) =>
        sendResponse({
          success: true,
          availability: resp?.availability ?? "unavailable",
        }),
      )
      .catch((err) => sendResponse({ success: false, error: err.message }))
    return true
  }

  sendResponse({ success: false, error: `Unknown action: ${msg?.action}` })
  return false
})

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "addToOmnifocusPopupSummary") return
  try {
    await handleSave({ llmEnabled: true })
  } catch (err) {
    log.error("command failed:", err)
  }
})

chrome.runtime.onInstalled.addListener(() => {
  log.info("onInstalled — kicking warmup")
  warmupSummarizer()
})

chrome.runtime.onStartup.addListener(() => {
  log.info("onStartup — kicking warmup")
  warmupSummarizer()
})

console.log("[of-ext] background loaded")
