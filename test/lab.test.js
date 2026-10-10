const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const Lib = require("../lib.js")

function element() {
  const handlers = new Map()
  return {
    value: "",
    textContent: "",
    disabled: false,
    hidden: false,
    children: [],
    attributes: {},
    classList: { add() {} },
    addEventListener(type, handler) {
      handlers.set(type, handler)
    },
    dispatch(type) {
      return handlers.get(type)?.({ target: this })
    },
    append(...children) {
      this.children.push(...children)
    },
    appendChild(child) {
      this.children.push(child)
      return child
    },
    replaceChildren(...children) {
      this.children = children
    },
    setAttribute(name, value) {
      this.attributes[name] = value
    },
    removeAttribute(name) {
      delete this.attributes[name]
    },
    click() {
      return this.dispatch("click")
    },
  }
}

function loadLab() {
  const ids = [
    "input",
    "run",
    "export",
    "status",
    "avail",
    "results",
    "loadTab",
    "opt-type",
    "opt-length",
    "opt-format",
    "opt-preference",
    "opt-output-lang",
    "opt-input-langs",
    "opt-shared",
  ]
  const elements = Object.fromEntries(ids.map((id) => [id, element()]))
  elements.loadTab.textContent = "Load recent page"
  elements.export.disabled = true
  const tbody = element()
  elements.results.querySelector = () => tbody
  const imports = []
  const runs = []
  const exports = []
  const chrome = {
    runtime: {
      sendMessage(message, callback) {
        if (message.action === "labGetTabText") imports.push(callback)
        else if (message.action === "summarizeWithOptions") runs.push({ message, callback })
        else if (message.action === "checkAvailability") callback({ availability: "available" })
        else throw new Error(`Unexpected action: ${message.action}`)
      },
    },
  }
  const context = vm.createContext({
    Lib,
    chrome,
    document: {
      addEventListener(type, callback) {
        assert.equal(type, "DOMContentLoaded")
        callback()
      },
      getElementById(id) {
        return elements[id]
      },
      createElement: element,
    },
    performance: { now: () => 0 },
    Blob: class {
      constructor(parts) {
        exports.push(JSON.parse(parts.join("")))
      }
    },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} },
    setTimeout() {},
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../lab.js"), "utf8"), context)
  return {
    elements,
    imports,
    runs,
    respondImport(index, response, error) {
      chrome.runtime.lastError = error ? { message: error } : undefined
      imports[index](response)
      delete chrome.runtime.lastError
    },
    async summarize() {
      const completion = elements.run.click()
      runs.at(-1).callback({ success: true, summary: "summary" })
      await completion
      elements.export.click()
      return exports.at(-1).results.at(-1)
    },
  }
}

describe("lab page imports", () => {
  const first = { success: true, text: "first page ".repeat(10), title: "First", url: "https://example.com/first" }
  const second = { success: true, text: "second page ".repeat(10), title: "Second", url: "https://example.com/second" }

  it("keeps user input when an import completes after an edit", async () => {
    const lab = loadLab()
    lab.elements.loadTab.click()
    assert.equal(lab.elements.loadTab.textContent, "Loading…")
    assert.equal(lab.elements.loadTab.attributes["aria-busy"], "true")
    lab.elements.input.value = "my edited text ".repeat(10)
    lab.elements.input.dispatch("input")
    const statusAfterEdit = lab.elements.status.textContent
    assert.equal(lab.elements.loadTab.textContent, "Load recent page")
    lab.respondImport(0, first)
    assert.equal(lab.elements.input.value, "my edited text ".repeat(10))
    assert.equal(lab.elements.status.textContent, statusAfterEdit)
    assert.equal((await lab.summarize()).source, null)
  })

  it("uses only the newest import even when callbacks arrive out of order", async () => {
    const lab = loadLab()
    lab.elements.loadTab.click()
    lab.elements.loadTab.click()
    lab.respondImport(1, second)
    const newestStatus = lab.elements.status.textContent
    lab.respondImport(0, first)
    assert.equal(lab.elements.input.value, second.text)
    assert.equal(lab.elements.status.textContent, newestStatus)
    assert.equal(lab.elements.loadTab.textContent, "Load recent page")
    const entry = await lab.summarize()
    assert.deepEqual(entry.source, { title: second.title, url: second.url })
  })

  it("does not let an older completion clear a newer loading state", () => {
    const lab = loadLab()
    lab.elements.loadTab.click()
    lab.elements.loadTab.click()
    lab.respondImport(0, first)
    assert.equal(lab.elements.loadTab.textContent, "Loading…")
    assert.equal(lab.elements.status.textContent, "Loading recent page text…")
    assert.equal(lab.elements.loadTab.attributes["aria-busy"], "true")
    lab.respondImport(1, second)
    assert.equal(lab.elements.input.value, second.text)
  })

  for (const transportError of [false, true]) {
    it(`retains existing text and provenance on ${transportError ? "transport" : "page"} errors`, async () => {
      const lab = loadLab()
      lab.elements.loadTab.click()
      lab.respondImport(0, first)
      lab.elements.loadTab.click()
      lab.respondImport(1, { success: false, error: "Cannot read page" }, transportError ? "Connection failed" : null)
      assert.equal(lab.elements.input.value, first.text)
      assert.equal(lab.elements.loadTab.textContent, "Load recent page")
      assert.equal(lab.elements.status.textContent, transportError ? "Connection failed" : "Cannot read page")
      const entry = await lab.summarize()
      assert.deepEqual(entry.source, { title: first.title, url: first.url })
    })
  }

  it("does not replace a newer run status when a pending import finishes", async () => {
    const lab = loadLab()
    lab.elements.loadTab.click()
    const running = lab.elements.run.click()
    const runStatus = lab.elements.status.textContent
    lab.respondImport(0, first)
    assert.equal(lab.elements.status.textContent, runStatus)
    assert.equal(lab.elements.loadTab.textContent, "Load recent page")
    lab.runs[0].callback({ success: true, summary: "summary" })
    await running
    assert.equal(lab.elements.status.textContent, "Run #1 done")
  })

  it("keeps a newer import's loading status when an earlier run finishes", async () => {
    const lab = loadLab()
    const running = lab.elements.run.click()
    lab.elements.loadTab.click()
    lab.runs[0].callback({ success: true, summary: "summary" })
    await running
    assert.equal(lab.elements.status.textContent, "Loading recent page text…")
    assert.equal(lab.elements.loadTab.textContent, "Loading…")
    lab.respondImport(0, first)
    assert.equal(lab.elements.status.textContent, `${first.text.length} chars from First`)
  })
})
