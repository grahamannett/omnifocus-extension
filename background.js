importScripts("lib.js")

const SUMMARY_TIMEOUT_MS = 60000
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

async function summarizeViaOffscreen(text, options) {
  const prepared = Lib.prepareText(text)
  await ensureOffscreen()
  const resp = await chrome.runtime.sendMessage({
    target: "offscreen",
    action: "summarize",
    text: prepared,
    options: options || null,
  })
  if (!resp?.ok) throw new Error(resp?.error || "summarize failed")
  return Lib.normalizeSummary(resp.summary)
}

function summarizeText(text, options) {
  return withTimeout(summarizeViaOffscreen(text, options), SUMMARY_TIMEOUT_MS, "summarize")
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

async function summarizeTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const text = await getTabText(tab)
  return summarizeText(text)
}

async function suggestMetaForTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const { projects = [], tags = [] } = await chrome.storage.sync.get(["projects", "tags"])
  // Nothing configured to suggest from → straight to Inbox, no inference.
  if (!projects.length && !tags.length) return { project: "", tags: [] }

  const text = await getTabText(tab)
  if (!text || text.length < Lib.SUMMARY_MIN_TEXT_LEN) return { project: "", tags: [] }
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

  const url = Lib.buildOmnifocusUrl({ name, note, project, tags, flag, due })

  log.info("opening omnifocus URL:", url)
  const newTab = await chrome.tabs.create({ url, active: true })
  log.info("opened tab", newTab.id)
  log.info("done")

  return { summarySkipped, skipReason }
}

async function handleSave(opts, tabId) {
  let tab
  if (tabId !== undefined) {
    if (!Number.isInteger(tabId) || tabId <= 0) throw new Error("Invalid source tab ID")
    tab = await chrome.tabs.get(tabId)
  } else {
    ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  }
  if (!tab) throw new Error("No active tab")
  return addToOmniFocus(tab, opts)
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Ignore messages destined for other endpoints.
  if (msg?.target === "offscreen" || msg?.target === "popup") return

  if (msg?.action === "addToOmnifocus") {
    handleSave(
      {
        llmEnabled: !!msg.llmEnabled,
        customTitle: typeof msg.customTitle === "string" ? msg.customTitle : null,
        customNote: typeof msg.customNote === "string" ? msg.customNote : null,
        project: msg.project ?? null,
        tags: Array.isArray(msg.tags) ? msg.tags : [],
        flag: !!msg.flag,
        due: msg.due ?? null,
      },
      msg.tabId,
    )
      .then(({ summarySkipped, skipReason }) => sendResponse({ success: true, summarySkipped, reason: skipReason }))
      .catch((err) => {
        log.error(err)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }

  if (msg?.action === "openPopup") {
    ;(async () => {
      if (!Number.isInteger(msg.tabId) || msg.tabId <= 0) throw new Error("Invalid source tab ID")
      return openPopup(await chrome.tabs.get(msg.tabId))
    })()
      .then((opened) => sendResponse({ success: true, opened }))
      .catch((err) => sendResponse({ success: false, error: err.message }))
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

  // Summary lab (lab.html): summarize caller-supplied text with caller-supplied
  // Summarizer option overrides. Same pipeline as the popup path.
  if (msg?.action === "summarizeWithOptions") {
    if (typeof msg.text !== "string") {
      sendResponse({ success: false, error: "no text" })
      return false
    }
    const options = Lib.buildSummarizerOptions(msg.options && typeof msg.options === "object" ? msg.options : undefined)
    summarizeText(msg.text, options)
      .then((summary) => sendResponse({ success: true, summary: summary || "" }))
      .catch((err) => {
        log.warn("lab summarize failed:", err.message)
        sendResponse({ success: false, error: err.message })
      })
    return true
  }
  if (msg?.action === "checkAvailability") {
    warmupSummarizer()
      .then((resp) =>
        sendResponse(
          resp?.ok
            ? {
                success: true,
                availability: resp.availability ?? "unavailable",
              }
            : { success: false, error: resp?.error || "Availability check failed" },
        ),
      )
      .catch((err) => sendResponse({ success: false, error: err.message }))
    return true
  }

  // Summary lab (lab.html): fetch another tab's readable text so a URL can
  // be summarized without manual copy-paste. Excludes the lab tab itself
  // (it's active while you click) and takes the most recently used tab.
  if (msg?.action === "labGetTabText") {
    ;(async () => {
      try {
        const windowId = _sender?.tab?.windowId
        const tabs = await chrome.tabs.query(windowId === undefined ? { currentWindow: true } : { windowId })
        const others = tabs
          .filter((t) => t.id !== _sender?.tab?.id && /^https?:\/\//i.test(t.url || ""))
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
        const tab = others[0]
        if (!tab) throw new Error("No other web page is open")
        const text = await getTabText(tab)
        sendResponse({ success: true, text, title: tab.title || "", url: tab.url || "" })
      } catch (err) {
        sendResponse({ success: false, error: err.message })
      }
    })()
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
  setupContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
  log.info("onStartup — kicking warmup")
  warmupSummarizer()
  setupContextMenus()
})

// ── selection context menu ("Clip to OmniFocus" between ChatGPT/Obsidian) ──
const MENU_PARENT = "of-add-selection"
const MENU_QUICK = "of-quick-save-selection"
const MENU_EDIT = "of-edit-selection"

function setupContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        // removeAll can report "no menu" on first install — safe to ignore.
      }
      chrome.contextMenus.create({
        id: MENU_PARENT,
        title: "Clip to OmniFocus",
        contexts: ["selection"],
      })
      chrome.contextMenus.create({
        id: MENU_QUICK,
        parentId: MENU_PARENT,
        title: "Quick-save selection",
        contexts: ["selection"],
      })
      chrome.contextMenus.create({
        id: MENU_EDIT,
        parentId: MENU_PARENT,
        title: "Edit before saving…",
        contexts: ["selection"],
      })
    })
  } catch (err) {
    log.warn("context menu setup failed:", err.message)
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_QUICK && info.menuItemId !== MENU_EDIT) return
  const selectionText = info.selectionText || ""
  if (!selectionText.trim()) {
    log.warn("context menu clicked with empty selection")
    return
  }
  if (!tab?.id) {
    log.error("context menu clicked with no tab")
    return
  }
  try {
    if (info.menuItemId === MENU_QUICK) {
      await addToOmniFocus(tab, {
        llmEnabled: false,
        customTitle: tab.title || "",
        customNote: Lib.buildNote(tab.url, Lib.quoteSelection(selectionText)),
        project: null,
        tags: [],
        flag: false,
        due: null,
      })
    } else {
      await openPopup(tab, selectionText)
    }
  } catch (err) {
    log.error("context menu save failed:", err)
  }
})

const CAPTURE_LIFETIME_MS = 5 * 60 * 1000

chrome.storage.session
  .remove("pendingSelection")
  .catch((err) => log.warn("legacy selection cleanup failed:", err.message))

async function openPopup(tab, selectionText) {
  if (!Number.isInteger(tab?.id) || tab.id <= 0) throw new Error("Invalid source tab ID")
  if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("Pop-out only works on http(s) pages")
  let captureId
  if (selectionText !== undefined) {
    if (typeof selectionText !== "string" || !selectionText.trim()) throw new Error("Empty selection")
    const records = await chrome.storage.session.get(null)
    const now = Date.now()
    const expired = Object.keys(records).filter(
      (key) =>
        key.startsWith("capture:") && Number.isFinite(records[key]?.ts) && now - records[key].ts >= CAPTURE_LIFETIME_MS,
    )
    if (expired.length) await chrome.storage.session.remove(expired)
    captureId = crypto.randomUUID()
    await chrome.storage.session.set({
      [`capture:${captureId}`]: { text: selectionText, tabId: tab.id, url: tab.url, title: tab.title || "", ts: now },
    })
  }
  let opened = false
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectModal,
      args: [tab.id, chrome.runtime.getURL("popup.html"), captureId || null],
    })
    if (typeof result?.result !== "boolean") throw new Error("Editor injection did not return a result")
    opened = result.result
    return opened
  } finally {
    if (captureId && !opened) await chrome.storage.session.remove(`capture:${captureId}`)
  }
}

// Self-contained: executed in the source page's isolated content-script world.
function injectModal(tabId, popupUrl, captureId) {
  const HOST_ID = "__omnifocus-saver-modal__"
  const existing = document.getElementById(HOST_ID)
  if (existing) {
    const iframe = existing.querySelector("iframe")
    iframe?.focus()
    iframe?.contentWindow?.postMessage({ __ofSaver: true, type: "capture-blocked" }, new URL(popupUrl).origin)
    return false
  }

  const host = document.createElement("div")
  host.id = HOST_ID
  Object.assign(host.style, {
    position: "fixed",
    top: "60px",
    right: "60px",
    width: "400px",
    height: "640px",
    zIndex: "2147483647",
    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
    background: "#fff",
    border: "1px solid rgba(0,0,0,0.2)",
    borderRadius: "4px",
    overflow: "hidden",
    colorScheme: "light",
  })

  const iframe = document.createElement("iframe")
  const url = new URL(popupUrl)
  url.searchParams.set("embedded", "1")
  url.searchParams.set("tabId", String(tabId))
  if (captureId) url.searchParams.set("captureId", captureId)
  iframe.src = url.href
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "0",
    display: "block",
    background: "#fff",
  })

  let dragging = false
  let dragOffsetX = 0
  let dragOffsetY = 0

  function onMouseMove(e) {
    if (!dragging) return
    const left = Math.max(0, e.clientX - dragOffsetX)
    const top = Math.max(0, e.clientY - dragOffsetY)
    host.style.left = `${left}px`
    host.style.top = `${top}px`
    host.style.right = "auto"
    host.style.bottom = "auto"
  }
  function onMouseUp() {
    if (!dragging) return
    dragging = false
    iframe.style.pointerEvents = ""
  }
  function onMessage(e) {
    if (e.source !== iframe.contentWindow) return
    const m = e.data
    if (!m || typeof m !== "object" || !m.__ofSaver) return
    if (m.type === "drag-start") {
      dragging = true
      dragOffsetX = m.clientX
      dragOffsetY = m.clientY
      // Disable iframe pointer events while dragging so the parent receives
      // mousemove even while the cursor is over the modal.
      iframe.style.pointerEvents = "none"
    } else if (m.type === "close") {
      cleanup()
    }
  }
  function onKey(e) {
    if (e.key === "Escape") cleanup()
  }
  function cleanup() {
    onMouseUp()
    document.removeEventListener("mousemove", onMouseMove)
    document.removeEventListener("mouseup", onMouseUp)
    document.removeEventListener("keydown", onKey)
    window.removeEventListener("message", onMessage)
    host.remove()
  }

  document.addEventListener("mousemove", onMouseMove)
  document.addEventListener("mouseup", onMouseUp)
  document.addEventListener("keydown", onKey)
  window.addEventListener("message", onMessage)
  host.appendChild(iframe)
  ;(document.body || document.documentElement).appendChild(host)
  return true
}

// Menus persist across service-worker restarts, but re-create on wake so a
// fresh install/upgrade never leaves the worker without them.
setupContextMenus()

console.log("[of-ext] background loaded")
