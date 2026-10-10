const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const Lib = require("../lib.js")

function element() {
  const handlers = new Map()
  const classes = new Set(["hidden"])
  let html = ""
  return {
    value: "",
    textContent: "",
    disabled: false,
    hidden: false,
    style: {},
    dataset: {},
    children: [],
    scrollHeight: 40,
    classList: {
      add(...names) {
        names.forEach((name) => classes.add(name))
      },
      remove(...names) {
        names.forEach((name) => classes.delete(name))
      },
      contains(name) {
        return classes.has(name)
      },
      toggle(name) {
        if (classes.has(name)) classes.delete(name)
        else classes.add(name)
      },
    },
    get innerHTML() {
      return html
    },
    set innerHTML(value) {
      html = value
      this.children = []
    },
    addEventListener(type, handler) {
      handlers.set(type, handler)
    },
    click() {
      return handlers.get("click")?.({ target: this })
    },
    append(...children) {
      for (const child of children) this.appendChild(child)
    },
    appendChild(child) {
      this.children.push(child)
      if (typeof child === "object") child.parent = this
      return child
    },
    insertBefore(child, before) {
      const index = this.children.indexOf(before)
      this.children.splice(index < 0 ? this.children.length : index, 0, child)
      child.parent = this
    },
    remove() {
      this.parent.children = this.parent.children.filter((child) => child !== this)
    },
    querySelectorAll(selector) {
      return this.children.filter((child) => selector === "button.tag" && child.className?.split(" ").includes("tag"))
    },
  }
}

async function loadPopup({ selection = false, suggestMeta = true, settingsError = false } = {}) {
  const elements = new Map()
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, element())
    return elements.get(id)
  }
  const tab = { id: 7, title: "Page title", url: "https://example.com/page" }
  const actions = []
  let requestedSettings
  let ready
  const document = {
    body: element(),
    documentElement: element(),
    getElementById,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: element,
    addEventListener(type, callback) {
      if (type === "DOMContentLoaded") ready = callback()
    },
  }
  const context = vm.createContext({
    Lib,
    document,
    URL,
    URLSearchParams,
    location: { search: selection ? "?embedded=1&tabId=7&captureId=clip" : "" },
    window: { parent: { postMessage() {} }, addEventListener() {}, close() {} },
    chrome: {
      tabs: { get: async () => tab, query: async () => [tab] },
      storage: {
        sync: {
          get: async (keys) => {
            requestedSettings = keys
            if (settingsError) throw new Error("Settings unavailable")
            return { theme: "dark", projects: ["Work"], tags: ["Reading"], suggestMeta }
          },
        },
        session: {
          get: async (key) => ({ [key]: { ...tab, tabId: tab.id, text: "full selected text", ts: Date.now() } }),
          remove: async () => {},
        },
      },
      runtime: {
        onMessage: { addListener() {} },
        sendMessage(message, callback) {
          actions.push(message.action)
          if (message.action === "suggestMeta") callback({ success: true, project: "Work", tags: ["Reading"] })
          else callback({ success: true, summary: "Page summary" })
        },
      },
    },
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"), context)
  await ready
  return { getElementById, actions, document, requestedSettings }
}

describe("popup model routing and settings", () => {
  it("loads selection text without any AI messages even with suggestions enabled", async () => {
    const popup = await loadPopup({ selection: true })
    assert.deepEqual(popup.actions, [])
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection("full selected text"))
    assert.equal(popup.getElementById("noteLabel").textContent, "Note · selection")
    assert.equal(popup.getElementById("save").disabled, false)
    assert.equal(popup.document.body.dataset.theme, "dark")
  })

  it("keeps upstream suggestion chips as explicit offers alongside theme settings", async () => {
    const popup = await loadPopup()
    assert.deepEqual(popup.actions, ["checkAvailability", "summarize", "suggestMeta"])
    assert.deepEqual(Array.from(popup.requestedSettings), ["theme", "projects", "tags", "suggestMeta"])
    assert.equal(popup.document.body.dataset.theme, "dark")
    assert.equal(popup.getElementById("project").value, "")
    const chips = popup.getElementById("suggestVal").children
    assert.equal(chips.length, 2)
    chips[0].click()
    assert.equal(popup.getElementById("project").value, "Work")
    chips[1].click()
    assert.equal(popup.getElementById("tags").children[0].textContent, "Reading")
    assert.equal(popup.getElementById("suggestRow").classList.contains("hidden"), true)
  })

  it("honors disabled suggestions while preserving page summaries", async () => {
    const popup = await loadPopup({ suggestMeta: false })
    assert.deepEqual(popup.actions, ["checkAvailability", "summarize"])
  })

  it("reports settings errors and keeps save disabled", async () => {
    const popup = await loadPopup({ settingsError: true })
    assert.equal(popup.getElementById("status").textContent, "Settings unavailable")
    assert.equal(popup.getElementById("save").disabled, true)
    assert.equal(popup.getElementById("noteLoading").style.display, "none")
    assert.deepEqual(popup.actions, [])
  })
})
