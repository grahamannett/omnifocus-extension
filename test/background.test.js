const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

function loadBackground({
  pageText = "A".repeat(5000),
  projects = ["Reading"],
  tags = ["Article"],
  injection = true,
  classifyResponse = { ok: true, project: "Reading", tags: ["Article"] },
  onExtract = () => {},
} = {}) {
  let listener
  let click
  let captureCounter = 0
  const sourceTab = { id: 17, url: "https://example.com/source", title: "Source article" }
  const activeTab = { id: 29, url: "https://example.com/active", title: "Another article" }
  const records = {}
  const modelMessages = []
  const createdTabs = []
  const scriptCalls = []
  const queriedTabs = []
  const lookedUpTabs = []
  const storageReads = { sync: [], session: [] }
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    URL,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => `capture-${++captureCounter}` },
    chrome: {
      runtime: {
        getURL: (filename) => `chrome-extension://extension/${filename}`,
        sendMessage: async (message) => {
          modelMessages.push(structuredClone(message))
          return message.action === "classify" ? classifyResponse : { ok: true, summary: "An article summary." }
        },
        onMessage: {
          addListener(callback) {
            listener = callback
          },
        },
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
      },
      tabs: {
        get: async (id) => {
          lookedUpTabs.push(id)
          if (id === sourceTab.id) return sourceTab
          if (id === activeTab.id) return activeTab
          throw new Error("No tab with ID")
        },
        query: async (query) => {
          queriedTabs.push(query)
          return [activeTab]
        },
        create: async (options) => {
          createdTabs.push(structuredClone(options))
          return { id: 40 }
        },
      },
      storage: {
        sync: {
          get: async (keys) => {
            storageReads.sync.push(structuredClone(keys))
            return { projects, tags }
          },
        },
        session: {
          get: async (keys) => {
            storageReads.session.push(structuredClone(keys))
            return structuredClone(records)
          },
          set: async (values) => Object.assign(records, structuredClone(values)),
          remove: async (keys) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key]
          },
        },
      },
      scripting: {
        executeScript: async (options) => {
          scriptCalls.push(options)
          if (!options.args) {
            await onExtract(sourceTab)
            return [{ result: pageText }]
          }
          if (injection instanceof Error) throw injection
          return [{ result: injection }]
        },
      },
      offscreen: { hasDocument: async () => true },
      commands: { onCommand: { addListener() {} } },
      contextMenus: {
        removeAll(callback) {
          callback()
        },
        create() {},
        onClicked: {
          addListener(callback) {
            click = callback
          },
        },
      },
    },
  })
  context.self = context
  context.importScripts = (...filenames) => {
    for (const filename of filenames) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, "..", filename), "utf8"), context, { filename })
    }
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8"), context, {
    filename: "background.js",
  })
  return {
    sourceTab,
    activeTab,
    records,
    modelMessages,
    createdTabs,
    scriptCalls,
    queriedTabs,
    lookedUpTabs,
    storageReads,
    click: (info, tab = sourceTab) => click(info, tab),
    request: (message) =>
      new Promise((resolve) => listener(message, {}, (response) => resolve(structuredClone(response)))),
  }
}

function eventTarget() {
  const listeners = new Map()
  return {
    addEventListener(type, handler, options) {
      const capture = typeof options === "boolean" ? options : !!options?.capture
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push({ handler, capture })
    },
    removeEventListener(type, handler, options) {
      const capture = typeof options === "boolean" ? options : !!options?.capture
      listeners.set(
        type,
        (listeners.get(type) || []).filter((entry) => entry.handler !== handler || entry.capture !== capture),
      )
    },
    dispatch(type, event = {}) {
      for (const { handler } of [...(listeners.get(type) || [])]) handler(event)
    },
    listenerCount() {
      return Array.from(listeners.values()).reduce((count, entries) => count + entries.length, 0)
    },
    usesCapture(type) {
      return listeners.get(type)?.some((entry) => entry.capture) || false
    },
  }
}

async function loadInjectedModal() {
  const app = loadBackground()
  await app.click({ menuItemId: "of-edit-selection", selectionText: "A selected paragraph." })
  const injection = app.scriptCalls.find((call) => call.args)
  const window = eventTarget()
  const document = {
    ...eventTarget(),
    hidden: false,
    visibilityState: "visible",
    getElementById: () => null,
    createElement(tagName) {
      return {
        tagName,
        style: {},
        children: [],
        contentWindow: tagName === "iframe" ? { postMessage() {} } : undefined,
        appendChild(child) {
          this.children.push(child)
          child.parent = this
        },
        querySelector(selector) {
          return this.children.find((child) => child.tagName === selector)
        },
        getBoundingClientRect() {
          return {
            left: this.style.left ? Number.parseFloat(this.style.left) : 800,
            top: Number.parseFloat(this.style.top) || 0,
            width: 400,
            height: 640,
          }
        },
        remove() {
          this.parent.children = this.parent.children.filter((child) => child !== this)
        },
      }
    },
  }
  document.body = document.createElement("body")
  document.documentElement = document.body
  const context = vm.createContext({ document, window, URL })
  const opened = vm.runInContext(`(${injection.func.toString()})`, context)(...injection.args)
  assert.equal(opened, true)
  const host = document.body.children[0]
  const iframe = host.querySelector("iframe")
  return {
    document,
    window,
    host,
    iframe,
    message(type, values = {}, source = iframe.contentWindow) {
      window.dispatch("message", { source, data: { __ofSaver: true, type, ...values } })
    },
  }
}

describe("injected editor dragging", () => {
  it("moves while the primary button is held and preserves the titlebar grab offset", async () => {
    const modal = await loadInjectedModal()
    modal.message("drag-start", { clientX: 20, clientY: 10 })
    assert.equal(modal.iframe.style.pointerEvents, "none")

    modal.document.dispatch("mousemove", { clientX: 850, clientY: 95, buttons: 1 })
    assert.equal(modal.host.style.left, "830px")
    assert.equal(modal.host.style.top, "85px")
    assert.equal(modal.host.style.right, "auto")
  })

  it("ends a drag before moving when the primary button is no longer held", async () => {
    const modal = await loadInjectedModal()
    const initialStyle = { ...modal.host.style }
    modal.message("drag-start", { clientX: 20, clientY: 10 })
    modal.document.dispatch("mousemove", { clientX: 850, clientY: 95, buttons: 0 })

    assert.deepEqual(modal.host.style, initialStyle)
    assert.equal(modal.iframe.style.pointerEvents, "")
    modal.document.dispatch("mousemove", { clientX: 900, clientY: 120, buttons: 1 })
    assert.deepEqual(modal.host.style, initialStyle)
  })

  it("honors a queued iframe release before later parent mouse movement", async () => {
    const modal = await loadInjectedModal()
    const initialStyle = { ...modal.host.style }
    // postMessage is asynchronous: the iframe can receive mouseup before the
    // parent processes drag-start. Both messages must leave dragging stopped.
    modal.message("drag-start", { clientX: 20, clientY: 10 })
    modal.message("drag-end")

    assert.equal(modal.iframe.style.pointerEvents, "")
    modal.document.dispatch("mousemove", { clientX: 850, clientY: 95, buttons: 0 })
    assert.deepEqual(modal.host.style, initialStyle)
  })

  for (const cancel of ["mouseup", "blur", "visibilitychange"]) {
    it(`cancels dragging on ${cancel}`, async () => {
      const modal = await loadInjectedModal()
      const initialStyle = { ...modal.host.style }
      modal.message("drag-start", { clientX: 20, clientY: 10 })
      if (cancel === "blur") modal.window.dispatch("blur")
      else {
        if (cancel === "visibilitychange") {
          modal.document.hidden = true
          modal.document.visibilityState = "hidden"
        }
        modal.document.dispatch(cancel, { button: 0, buttons: 0 })
      }

      assert.equal(modal.iframe.style.pointerEvents, "")
      modal.document.dispatch("mousemove", { clientX: 850, clientY: 95, buttons: 1 })
      assert.deepEqual(modal.host.style, initialStyle)
    })
  }

  it("removes the host and every parent listener on close", async () => {
    const modal = await loadInjectedModal()
    modal.message("drag-start", { clientX: 20, clientY: 10 })
    modal.message("close")

    assert.equal(modal.document.body.children.length, 0)
    assert.equal(modal.iframe.style.pointerEvents, "")
    assert.equal(modal.document.listenerCount(), 0)
    assert.equal(modal.window.listenerCount(), 0)
  })

  it("uses capture listeners so the page cannot swallow drag movement or release", async () => {
    const modal = await loadInjectedModal()
    assert.equal(modal.document.usesCapture("mousemove"), true)
    assert.equal(modal.document.usesCapture("mouseup"), true)
  })

  it("ignores drag and close messages from another frame", async () => {
    const modal = await loadInjectedModal()
    const initialStyle = { ...modal.host.style }
    modal.message("drag-start", { clientX: 20, clientY: 10 }, {})
    modal.document.dispatch("mousemove", { clientX: 850, clientY: 95, buttons: 1 })
    assert.deepEqual(modal.host.style, initialStyle)

    modal.message("drag-start", { clientX: 20, clientY: 10 })
    modal.message("drag-end", {}, {})
    assert.equal(modal.iframe.style.pointerEvents, "none")
    modal.message("close", {}, {})
    assert.equal(modal.document.body.children.length, 1)
  })
})

describe("background integration routes", () => {
  it("retains project/tag suggestions after helper extraction and truncates classifier input", async () => {
    const app = loadBackground()
    const response = await app.request({ action: "suggestMeta", tabId: app.sourceTab.id })

    assert.deepEqual(response, { success: true, project: "Reading", tags: ["Article"] })
    assert.equal(app.modelMessages.length, 1)
    assert.deepEqual(app.modelMessages[0], {
      target: "offscreen",
      action: "classify",
      text: "A".repeat(4000),
      title: app.sourceTab.title,
      url: app.sourceTab.url,
      projects: ["Reading"],
      tags: ["Article"],
    })
    assert.equal(app.scriptCalls[0].target.tabId, app.sourceTab.id)
  })

  it("skips classifier inference for short text or absent configured names", async () => {
    for (const [options, skipped] of [
      [{ pageText: "Too short." }, "text-too-short"],
      [{ projects: [], tags: [] }, "no-configured-names"],
    ]) {
      const app = loadBackground(options)
      assert.deepEqual(await app.request({ action: "suggestMeta", tabId: app.sourceTab.id }), {
        success: true,
        project: "",
        tags: [],
        skipped,
      })
      assert.equal(app.modelMessages.length, 0)
    }
  })

  it("reports genuine empty model matches without marking inference as skipped", async () => {
    for (const action of ["suggestMeta", "suggestMetaForText"]) {
      const app = loadBackground({ classifyResponse: { ok: true, project: "", tags: [] } })
      const result = await app.request({ action, tabId: app.sourceTab.id, text: "Selected passage. ".repeat(20) })
      assert.deepEqual(result, { success: true, project: "", tags: [] })
      assert.equal(app.modelMessages.length, 1)
    }
  })

  it("suggests stored project/tag names from selected text without reading its page or capture", async () => {
    const app = loadBackground({
      pageText: "Unrelated page content.".repeat(100),
      projects: ["Work"],
      tags: ["Review"],
    })
    const text = "A selected passage about a review at work. ".repeat(3)
    app.records["capture:draft"] = { text: "An older draft", tabId: app.sourceTab.id }
    const response = await app.request({
      action: "suggestMetaForText",
      text,
      title: "Selection source",
      url: "https://example.com/selection",
      tabId: app.sourceTab.id,
      captureId: "draft",
      projects: ["Injected project"],
      tags: ["Injected tag"],
    })

    assert.deepEqual(response, { success: true, project: "Reading", tags: ["Article"] })
    assert.deepEqual(app.modelMessages, [
      {
        target: "offscreen",
        action: "classify",
        text,
        title: "Selection source",
        url: "https://example.com/selection",
        projects: ["Work"],
        tags: ["Review"],
      },
    ])
    assert.deepEqual(app.storageReads.sync, [["projects", "tags"]])
    assert.deepEqual(app.storageReads.session, [])
    assert.deepEqual(app.lookedUpTabs, [])
    assert.deepEqual(app.scriptCalls, [])
    assert.deepEqual(app.queriedTabs, [])
    assert.equal(app.records["capture:draft"].text, "An older draft")
  })

  it("truncates only the selection sent to the classifier and defaults invalid optional context", async () => {
    const app = loadBackground()
    const text = "Selected text with punctuation.\n".repeat(200)
    app.records["capture:draft"] = { text, tabId: app.sourceTab.id }
    await app.request({ action: "suggestMetaForText", text, title: 17, url: null })

    assert.equal(app.modelMessages[0].text, text.slice(0, 4000))
    assert.equal(app.modelMessages[0].title, "")
    assert.equal(app.modelMessages[0].url, "")
    assert.equal(app.records["capture:draft"].text, text)
  })

  it("skips selection classification for short text or no configured names", async () => {
    for (const [{ text, ...options }, skipped] of [
      [{ text: "Too short." }, "text-too-short"],
      [{ text: "Selected passage. ".repeat(20), projects: [], tags: [] }, "no-configured-names"],
    ]) {
      const app = loadBackground(options)
      assert.deepEqual(await app.request({ action: "suggestMetaForText", text }), {
        success: true,
        project: "",
        tags: [],
        skipped,
      })
      assert.deepEqual(app.modelMessages, [])
      assert.deepEqual(app.lookedUpTabs, [])
      assert.deepEqual(app.scriptCalls, [])
    }
  })

  it("rejects missing or invalid text for selection AI requests", async () => {
    for (const action of ["suggestMetaForText", "summarizeSelection"]) {
      for (const text of [undefined, null, 42, {}]) {
        const app = loadBackground()
        assert.deepEqual(await app.request({ action, text }), { success: false, error: "no text" })
        assert.deepEqual(app.modelMessages, [])
        assert.deepEqual(app.storageReads, { sync: [], session: [] })
        assert.deepEqual(app.lookedUpTabs, [])
        assert.deepEqual(app.scriptCalls, [])
      }
    }
  })

  it("summarizes only the selected passage with fixed selection-specific context", async () => {
    const app = loadBackground({ pageText: "Unrelated page content.".repeat(100) })
    const text = "The selected passage explains the decision and its outcome. ".repeat(2)
    assert.deepEqual(
      await app.request({
        action: "summarizeSelection",
        text,
        tabId: app.sourceTab.id,
        options: { sharedContext: "Use the whole page instead" },
      }),
      {
        success: true,
        summary: "An article summary.",
      },
    )
    assert.deepEqual(app.modelMessages, [
      {
        target: "offscreen",
        action: "summarize",
        text,
        options: {
          sharedContext:
            "Summarize the following selected passage in a single plain-language sentence. Use only the information in the passage.",
        },
      },
    ])
    assert.deepEqual(app.storageReads, { sync: [], session: [] })
    assert.deepEqual(app.lookedUpTabs, [])
    assert.deepEqual(app.scriptCalls, [])
    assert.deepEqual(app.queriedTabs, [])
  })

  it("keeps the existing summary input bounds for selection summaries", async () => {
    const app = loadBackground()
    const short = await app.request({ action: "summarizeSelection", text: "Too short." })
    assert.equal(short.success, false)
    assert.match(short.error, /text too short/i)
    assert.deepEqual(app.modelMessages, [])

    const text = "Selected passage with details. ".repeat(400)
    await app.request({ action: "summarizeSelection", text })
    assert.equal(app.modelMessages[0].text, text.slice(0, 8000))
  })

  it("retains production summary and lab option routes alongside classifier suggestions", async () => {
    const app = loadBackground()
    assert.deepEqual(await app.request({ action: "summarize", tabId: app.sourceTab.id }), {
      success: true,
      summary: "An article summary.",
    })
    assert.deepEqual(
      await app.request({ action: "summarizeWithOptions", text: "B".repeat(9000), options: { length: "long" } }),
      {
        success: true,
        summary: "An article summary.",
      },
    )
    assert.equal(app.modelMessages[0].options, null)
    assert.equal(app.modelMessages[1].options.length, "long")
    assert.equal(app.modelMessages[1].text.length, 8000)
    assert.deepEqual(app.lookedUpTabs, [app.sourceTab.id])
  })

  it("summarizes the expected source page and rechecks its URL after extraction", async () => {
    const app = loadBackground()
    assert.deepEqual(
      await app.request({
        action: "summarize",
        tabId: app.sourceTab.id,
        expectedUrl: app.sourceTab.url,
      }),
      {
        success: true,
        summary: "An article summary.",
      },
    )
    assert.deepEqual(app.lookedUpTabs, [app.sourceTab.id, app.sourceTab.id])
    assert.equal(app.scriptCalls.length, 1)
    assert.equal(app.scriptCalls[0].target.tabId, app.sourceTab.id)
    assert.equal(app.modelMessages.length, 1)
    assert.equal(app.modelMessages[0].text, "A".repeat(5000))
  })

  it("rejects a changed source page before extraction or model inference", async () => {
    const app = loadBackground()
    assert.deepEqual(
      await app.request({
        action: "summarize",
        tabId: app.sourceTab.id,
        expectedUrl: "https://example.com/original",
      }),
      {
        success: false,
        error: "Source page changed. Close this editor and open it again.",
      },
    )
    assert.deepEqual(app.lookedUpTabs, [app.sourceTab.id])
    assert.deepEqual(app.scriptCalls, [])
    assert.deepEqual(app.modelMessages, [])
  })

  it("rejects navigation during page extraction before model inference", async () => {
    const app = loadBackground({
      onExtract: (tab) => {
        tab.url = "https://example.com/another-page"
      },
    })
    assert.deepEqual(
      await app.request({
        action: "summarize",
        tabId: app.sourceTab.id,
        expectedUrl: app.sourceTab.url,
      }),
      {
        success: false,
        error: "Source page changed. Close this editor and open it again.",
      },
    )
    assert.deepEqual(app.lookedUpTabs, [app.sourceTab.id, app.sourceTab.id])
    assert.equal(app.scriptCalls.length, 1)
    assert.deepEqual(app.modelMessages, [])
  })

  it("rejects a non-string expected source URL before reading the source tab", async () => {
    for (const expectedUrl of [null, 17, {}, true]) {
      const app = loadBackground()
      assert.deepEqual(await app.request({ action: "summarize", tabId: app.sourceTab.id, expectedUrl }), {
        success: false,
        error: "Invalid expected source URL",
      })
      assert.deepEqual(app.lookedUpTabs, [])
      assert.deepEqual(app.scriptCalls, [])
      assert.deepEqual(app.modelMessages, [])
    }
  })

  it("saves from the explicit source tab when another tab is active", async () => {
    const app = loadBackground()
    assert.deepEqual(
      await app.request({ action: "addToOmnifocus", tabId: app.sourceTab.id, customNote: "Captured note" }),
      {
        success: true,
        summarySkipped: false,
        reason: null,
      },
    )
    const params = new URL(app.createdTabs[0].url).searchParams
    assert.equal(params.get("name"), app.sourceTab.title)
    assert.equal(params.get("note"), "Captured note")
    assert.equal(app.queriedTabs.length, 0)
  })

  it("quick-saves the complete selection and source URL without model inference", async () => {
    const app = loadBackground()
    const selection = "Selected text & punctuation\n".repeat(400)
    await app.click({ menuItemId: "of-quick-save-selection", selectionText: selection })
    const params = new URL(app.createdTabs[0].url).searchParams
    assert.equal(params.get("name"), app.sourceTab.title)
    assert.equal(params.get("note"), `${app.sourceTab.url}\n\n“${selection}”`)
    assert.equal(app.modelMessages.length, 0)
    assert.deepEqual(app.records, {})
  })

  it("stores an edit capture for the source tab and passes its ID to the injected editor", async () => {
    const app = loadBackground()
    await app.click({ menuItemId: "of-edit-selection", selectionText: "A selected paragraph." })
    assert.equal(app.createdTabs.length, 0)
    const capture = app.records["capture:capture-1"]
    assert.equal(capture.text, "A selected paragraph.")
    assert.equal(capture.tabId, app.sourceTab.id)
    assert.equal(capture.url, app.sourceTab.url)
    assert.ok(Number.isFinite(capture.ts))
    assert.deepEqual(structuredClone(app.scriptCalls[0].args), [
      app.sourceTab.id,
      "chrome-extension://extension/popup.html",
      "capture-1",
    ])
  })

  it("discards only the new capture when the existing editor blocks injection or injection fails", async () => {
    for (const injection of [false, new Error("Injection failed")]) {
      const app = loadBackground({ injection })
      app.records["capture:existing"] = { ts: Date.now(), text: "Existing draft", tabId: app.sourceTab.id }
      await app.click({ menuItemId: "of-edit-selection", selectionText: "New selection." })
      assert.deepEqual(Object.keys(app.records), ["capture:existing"])
      assert.equal(app.records["capture:existing"].text, "Existing draft")
    }
  })
})
