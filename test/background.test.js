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
          return message.action === "classify"
            ? { ok: true, project: "Reading", tags: ["Article"] }
            : { ok: true, summary: "An article summary." }
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
        sync: { get: async () => ({ projects, tags }) },
        session: {
          get: async () => structuredClone(records),
          set: async (values) => Object.assign(records, structuredClone(values)),
          remove: async (keys) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete records[key]
          },
        },
      },
      scripting: {
        executeScript: async (options) => {
          scriptCalls.push(options)
          if (!options.args) return [{ result: pageText }]
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
    click: (info, tab = sourceTab) => click(info, tab),
    request: (message) =>
      new Promise((resolve) => listener(message, {}, (response) => resolve(structuredClone(response)))),
  }
}

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
    for (const options of [{ pageText: "Too short." }, { projects: [], tags: [] }]) {
      const app = loadBackground(options)
      assert.deepEqual(await app.request({ action: "suggestMeta", tabId: app.sourceTab.id }), {
        success: true,
        project: "",
        tags: [],
      })
      assert.equal(app.modelMessages.length, 0)
    }
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
