const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const Lib = require("../lib.js")
const defaultSelectionText = "A selected passage about organizing a reading list and saving useful web pages for later."

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
      toggle(name, force) {
        if (force === true || (force === undefined && !classes.has(name))) {
          classes.add(name)
          return true
        }
        classes.delete(name)
        return false
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
    dispatch(type, event = {}) {
      return handlers.get(type)?.({ target: this, preventDefault() {}, ...event })
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

async function loadPopup({
  selection = false,
  suggestMeta = true,
  settingsError = false,
  selectionText = defaultSelectionText,
  deferSummary = false,
  deferPageSummary = false,
  deferSuggestions = false,
  projects = ["Work"],
  tags = ["Reading"],
  saveResponse = { success: true },
} = {}) {
  const elements = new Map()
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, element())
    return elements.get(id)
  }
  const tab = { id: 7, title: "Page title", url: "https://example.com/page" }
  const actions = []
  const messages = []
  const parentMessages = []
  const documentHandlers = new Map()
  const windowHandlers = new Map()
  const titlebar = element()
  let requestedSettings
  let ready
  const document = {
    hidden: false,
    body: element(),
    documentElement: element(),
    getElementById,
    querySelectorAll: () => [],
    querySelector: (selector) => (selector === ".pop-titlebar" ? titlebar : null),
    createElement: element,
    addEventListener(type, callback) {
      if (type === "DOMContentLoaded") ready = callback()
      else documentHandlers.set(type, callback)
    },
    dispatch(type, event = {}) {
      return documentHandlers.get(type)?.(event)
    },
  }
  const window = {
    parent: { postMessage: (message) => parentMessages.push(structuredClone(message)) },
    addEventListener: (type, handler) => windowHandlers.set(type, handler),
    dispatch: (type, event = {}) => windowHandlers.get(type)?.(event),
    close() {},
  }
  let selectionSummaryCallback
  let pageSummaryCallback
  let suggestionsCallback
  let lastError
  let errorChecked
  const uncheckedErrors = []
  const runtime = {
    get lastError() {
      errorChecked = true
      return lastError
    },
    onMessage: { addListener() {} },
    sendMessage(message, callback) {
      actions.push(message.action)
      messages.push(structuredClone(message))
      if (message.action === "suggestMeta" || message.action === "suggestMetaForText") {
        suggestionsCallback = callback
        if (!deferSuggestions) resolveSuggestions()
      } else if (message.action === "summarizeSelection") {
        selectionSummaryCallback = callback
        if (!deferSummary) resolveSelectionSummary()
      } else if (message.action === "summarize") {
        pageSummaryCallback = callback
        if (!deferPageSummary) resolvePageSummary()
      } else if (message.action === "addToOmnifocus") callback(saveResponse)
      else callback({ success: true, summary: "Page summary" })
    },
  }
  function deliverResponse(callback, response, error) {
    lastError = error ? { message: error } : undefined
    errorChecked = false
    try {
      callback(response)
    } finally {
      if (error && !errorChecked) uncheckedErrors.push(`Unchecked runtime.lastError: ${error}`)
      lastError = undefined
    }
  }
  function resolveSuggestions(response = { success: true, project: "Work", tags: ["Reading"] }, error) {
    assert.ok(suggestionsCallback, "a metadata suggestion request should be pending")
    const callback = suggestionsCallback
    suggestionsCallback = undefined
    deliverResponse(callback, response, error)
  }
  function resolveSelectionSummary(response = { success: true, summary: "Selection summary" }, error) {
    assert.ok(selectionSummaryCallback, "a selection summary request should be pending")
    const callback = selectionSummaryCallback
    selectionSummaryCallback = undefined
    deliverResponse(callback, response, error)
  }
  function resolvePageSummary(response = { success: true, summary: "Page summary" }, error) {
    assert.ok(pageSummaryCallback, "a page summary request should be pending")
    const callback = pageSummaryCallback
    pageSummaryCallback = undefined
    deliverResponse(callback, response, error)
  }
  const context = vm.createContext({
    Lib,
    document,
    URL,
    URLSearchParams,
    setTimeout() {},
    location: { search: selection ? "?embedded=1&tabId=7&captureId=clip" : "" },
    window,
    chrome: {
      tabs: { get: async () => tab, query: async () => [tab] },
      storage: {
        sync: {
          get: async (keys) => {
            requestedSettings = keys
            if (settingsError) throw new Error("Settings unavailable")
            return { theme: "dark", projects, tags, suggestMeta }
          },
        },
        session: {
          get: async (key) => ({ [key]: { ...tab, tabId: tab.id, text: selectionText, ts: Date.now() } }),
          remove: async () => {},
        },
      },
      runtime,
    },
  })
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8"), context)
  await ready
  return {
    getElementById,
    actions,
    messages,
    document,
    window,
    requestedSettings,
    titlebar,
    parentMessages,
    resolveSuggestions,
    resolveSelectionSummary,
    resolvePageSummary,
    uncheckedErrors,
  }
}

describe("popup model routing and settings", () => {
  it("preserves the full selection and requests metadata from that selection without a page summary", async () => {
    const popup = await loadPopup({ selection: true })
    assert.deepEqual(popup.messages, [
      {
        action: "suggestMetaForText",
        text: defaultSelectionText,
        title: "Page title",
        url: "https://example.com/page",
      },
    ])
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(defaultSelectionText))
    assert.equal(popup.getElementById("noteLabel").textContent, "Note · selection")
    assert.equal(popup.getElementById("save").disabled, false)
    assert.equal(popup.document.body.dataset.theme, "dark")
    assert.equal(popup.getElementById("project").value, "")
    const chips = popup.getElementById("suggestVal").children
    assert.equal(chips.length, 2)
    chips[0].click()
    chips[1].click()
    assert.equal(popup.getElementById("project").value, "Work")
    assert.equal(popup.getElementById("tags").children[0].textContent, "Reading")
  })

  it("honors disabled selection suggestions and keeps the quote ready to save", async () => {
    const popup = await loadPopup({ selection: true, suggestMeta: false })
    assert.deepEqual(popup.actions, [])
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(defaultSelectionText))
    assert.equal(popup.getElementById("save").disabled, false)
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

describe("popup suggestion status", () => {
  function assertStatus(popup, expected) {
    const status = popup.getElementById("suggestStatus")
    assert.equal(status.textContent, expected)
    assert.equal(status.classList.contains("hidden"), false)
    assert.equal(popup.getElementById("suggestRow").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("suggestVal").children.length, 0)
  }

  for (const selection of [false, true]) {
    const source = selection ? "selection" : "page"

    it(`shows pending ${source} suggestions before rendering explicit offer chips`, async () => {
      const popup = await loadPopup({ selection, deferSuggestions: true })
      const row = popup.getElementById("suggestRow")
      const status = popup.getElementById("suggestStatus")
      const chips = popup.getElementById("suggestVal")
      assert.equal(row.classList.contains("hidden"), false)
      assert.equal(status.classList.contains("hidden"), false)
      assert.equal(status.textContent, "Finding project/tag suggestions…")
      assert.equal(chips.children.length, 0)
      assert.equal(popup.getElementById("save").disabled, false)

      popup.resolveSuggestions()

      assert.equal(status.classList.contains("hidden"), true)
      assert.equal(chips.children.length, 2)
      assert.equal(popup.getElementById("project").value, "")
      chips.children[0].click()
      assert.equal(row.classList.contains("hidden"), false)
      chips.children[0].click()
      assert.equal(row.classList.contains("hidden"), true)
    })

    it(`explains a successful ${source} result with no matching configured names`, async () => {
      for (const response of [
        { success: true, project: "", tags: [] },
        { success: true, project: "Invented project", tags: ["Invented tag"] },
      ]) {
        const popup = await loadPopup({ selection, deferSuggestions: true })
        popup.resolveSuggestions(response)
        assertStatus(popup, "No new project/tag suggestions.")
        assert.equal(popup.getElementById("save").disabled, false)
        assert.equal(popup.getElementById("project").value, "")
      }
    })

    it(`shows ${source} classifier failures without changing the note or blocking saves`, async () => {
      const popup = await loadPopup({ selection, deferSuggestions: true })
      const note = popup.getElementById("note").value
      popup.resolveSuggestions({ success: false, error: "Prompt API unavailable" })
      assertStatus(popup, "Suggestions unavailable: Prompt API unavailable")
      assert.equal(popup.getElementById("note").value, note)
      assert.equal(popup.getElementById("save").disabled, false)
    })

    it(`shows ${source} messaging failures and consumes runtime.lastError`, async () => {
      const popup = await loadPopup({ selection, deferSuggestions: true })
      popup.resolveSuggestions(undefined, "Connection closed")
      assertStatus(popup, "Suggestions unavailable: Connection closed")
      assert.deepEqual(popup.uncheckedErrors, [])
      assert.equal(popup.getElementById("save").disabled, false)
    })

    it(`explains disabled ${source} suggestions without requesting inference`, async () => {
      const popup = await loadPopup({ selection, suggestMeta: false })
      assertStatus(popup, "AI suggestions are off in Settings.")
      assert.equal(
        popup.actions.some((action) => action === "suggestMeta" || action === "suggestMetaForText"),
        false,
      )
    })

    it(`explains missing configured names for ${source} suggestions without requesting inference`, async () => {
      const popup = await loadPopup({ selection, projects: [], tags: [] })
      assertStatus(popup, "Add projects or tags in Settings for suggestions.")
      assert.equal(
        popup.actions.some((action) => action === "suggestMeta" || action === "suggestMetaForText"),
        false,
      )
    })

    it(`distinguishes skipped ${source} inference from an empty model result`, async () => {
      for (const [skipped, expected] of [
        [
          "text-too-short",
          selection ? "Select at least 50 characters for suggestions." : "Page text is too short for suggestions.",
        ],
        ["no-configured-names", "Add projects or tags in Settings for suggestions."],
      ]) {
        const popup = await loadPopup({ selection, deferSuggestions: true })
        popup.resolveSuggestions({ success: true, project: "", tags: [], skipped })
        assertStatus(popup, expected)
      }
    })
  }

  it("explains a short capture and skips the metadata request while preserving the quote", async () => {
    const selectionText = "x".repeat(49)
    const popup = await loadPopup({ selection: true, selectionText })
    assertStatus(popup, "Select at least 50 characters for suggestions.")
    assert.deepEqual(popup.actions, [])
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
    assert.equal(popup.getElementById("save").disabled, false)
  })

  it("explains when matching tags were already selected while inference was pending", async () => {
    const popup = await loadPopup({ selection: true, deferSuggestions: true })
    popup.getElementById("tagAdd").dispatch("change", { target: { value: "Reading" } })
    popup.resolveSuggestions({ success: true, project: "", tags: ["Reading"] })
    assertStatus(popup, "No new project/tag suggestions.")
    assert.equal(popup.getElementById("tags").children[0].textContent, "Reading")
  })

  it("requests metadata for a capture at the minimum text length", async () => {
    const selectionText = "x".repeat(50)
    const popup = await loadPopup({ selection: true, selectionText, deferSuggestions: true })
    assertStatus(popup, "Finding project/tag suggestions…")
    assert.equal(popup.messages[0].action, "suggestMetaForText")
    assert.equal(popup.messages[0].text, selectionText)
  })

  for (const error of [undefined, "Connection closed after close"]) {
    it(`ignores ${error ? "failed" : "successful"} metadata responses after closing while consuming messaging errors`, async () => {
      const popup = await loadPopup({ selection: true, deferSuggestions: true })
      const snapshot = () => ({
        status: popup.getElementById("suggestStatus").textContent,
        statusHidden: popup.getElementById("suggestStatus").classList.contains("hidden"),
        rowHidden: popup.getElementById("suggestRow").classList.contains("hidden"),
        chips: popup.getElementById("suggestVal").children.length,
        project: popup.getElementById("project").value,
        note: popup.getElementById("note").value,
      })
      const previous = snapshot()
      popup.getElementById("cancel").click()
      popup.resolveSuggestions(undefined, error)
      assert.deepEqual(snapshot(), previous)
      assert.deepEqual(popup.uncheckedErrors, [])
    })
  }
})

describe("selection summary review", () => {
  const selectionText =
    "  A selected passage about organizing a reading list.\nIt includes useful details and Unicode 🦉.  "

  it("only summarizes on request and previews the result before inserting it above the intact quote", async () => {
    const popup = await loadPopup({ selection: true, selectionText })
    const note = popup.getElementById("note")
    assert.equal(popup.getElementById("summaryAi").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("summarySource").textContent, "Selection")
    assert.equal(popup.getElementById("generateSummary").textContent, "Summarize")
    assert.deepEqual(popup.actions, ["suggestMetaForText"])
    popup.getElementById("generateSummary").click()

    assert.deepEqual(popup.messages[1], { action: "summarizeSelection", text: selectionText })
    assert.equal(note.value, Lib.quoteSelection(selectionText))
    assert.equal(popup.getElementById("summaryPreviewText").textContent, "Selection summary")
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("generateSummary").textContent, "Regenerate summary")
    assert.equal(popup.getElementById("applySummary").textContent, "Add to note")
    popup.getElementById("applySummary").click()
    const expected = `Selection summary\n\n${Lib.quoteSelection(selectionText)}`
    assert.equal(note.value, expected)
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), true)
    popup.getElementById("applySummary").click()
    assert.equal(note.value, expected)

    popup.getElementById("save").click()
    const saved = popup.messages.at(-1)
    assert.equal(saved.action, "addToOmnifocus")
    assert.equal(saved.customNote, `https://example.com/page\n\n${expected}`)
  })

  it("preserves edits made while inference is pending and does not send duplicate requests", async () => {
    const popup = await loadPopup({ selection: true, selectionText, deferSummary: true })
    const summarize = popup.getElementById("generateSummary")
    summarize.click()
    assert.equal(summarize.disabled, true)
    assert.equal(popup.getElementById("save").disabled, false)
    summarize.click()
    assert.equal(popup.actions.filter((action) => action === "summarizeSelection").length, 1)
    const edited = `${Lib.quoteSelection(selectionText)}\n\nMy own note.`
    popup.getElementById("note").value = edited
    popup.getElementById("note").dispatch("input")
    popup.resolveSelectionSummary()
    assert.equal(popup.getElementById("note").value, edited)
    popup.getElementById("applySummary").click()
    assert.equal(popup.getElementById("note").value, `Selection summary\n\n${edited}`)
  })

  it("shows failures without changing the note and permits a retry", async () => {
    const popup = await loadPopup({ selection: true, selectionText, deferSummary: true })
    popup.getElementById("generateSummary").click()
    popup.resolveSelectionSummary({ success: false, error: "AI unavailable" })
    assert.equal(popup.getElementById("summaryStatus").textContent, "AI unavailable")
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), true)
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
    assert.equal(popup.getElementById("generateSummary").disabled, false)
    assert.equal(popup.getElementById("save").disabled, false)
    popup.getElementById("generateSummary").click()
    popup.resolveSelectionSummary()
    assert.equal(popup.getElementById("summaryStatus").textContent, "")
    assert.equal(popup.getElementById("summaryStatus").classList.contains("error"), false)
    assert.equal(popup.getElementById("applySummary").disabled, false)
  })

  it("handles Chrome messaging failures and empty AI output without inserting anything", async () => {
    for (const [response, error] of [[undefined, "Connection closed"], [{ success: true, summary: "  " }]]) {
      const popup = await loadPopup({ selection: true, selectionText, deferSummary: true })
      popup.getElementById("generateSummary").click()
      popup.resolveSelectionSummary(response, error)
      assert.equal(popup.getElementById("summaryStatus").textContent, error || "No summary returned. Try again.")
      assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
      assert.equal(popup.getElementById("applySummary").disabled, true)
    }
  })

  it("keeps very short captures editable and explains why summarization is disabled", async () => {
    const popup = await loadPopup({ selection: true, selectionText: "Short quote", suggestMeta: false })
    assert.equal(popup.getElementById("generateSummary").disabled, true)
    assert.equal(popup.getElementById("summaryStatus").textContent, "Select at least 50 characters to summarize.")
    popup.getElementById("generateSummary").click()
    assert.deepEqual(popup.actions, [])
    assert.equal(popup.getElementById("note").value, "“Short quote”")
    assert.equal(popup.getElementById("save").disabled, false)
  })

  it("allows an explicit summary when automatic metadata suggestions are disabled", async () => {
    const popup = await loadPopup({ selection: true, selectionText, suggestMeta: false })
    assert.deepEqual(popup.actions, [])
    popup.getElementById("generateSummary").click()
    assert.deepEqual(popup.actions, ["summarizeSelection"])
    assert.equal(popup.getElementById("applySummary").disabled, false)
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
  })

  it("saves the current quote while a summary is pending and keeps late results out of the saved note", async () => {
    const popup = await loadPopup({ selection: true, selectionText, deferSummary: true })
    popup.getElementById("generateSummary").click()
    popup.getElementById("save").click()
    const expected = `https://example.com/page\n\n${Lib.quoteSelection(selectionText)}`
    assert.equal(popup.messages.at(-1).customNote, expected)
    popup.resolveSelectionSummary()
    assert.equal(popup.getElementById("generateSummary").disabled, true)
    assert.equal(popup.getElementById("applySummary").disabled, true)
    popup.getElementById("applySummary").click()
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
    assert.equal(popup.messages.at(-1).customNote, expected)
  })

  it("restores AI controls and keeps the preview after saving fails", async () => {
    const popup = await loadPopup({
      selection: true,
      selectionText,
      saveResponse: { success: false, error: "Save failed" },
    })
    popup.getElementById("generateSummary").click()
    popup.getElementById("save").click()
    assert.equal(popup.getElementById("save").disabled, false)
    assert.equal(popup.getElementById("generateSummary").disabled, false)
    assert.equal(popup.getElementById("applySummary").disabled, false)
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
    popup.getElementById("applySummary").click()
    assert.equal(popup.getElementById("note").value, `Selection summary\n\n${Lib.quoteSelection(selectionText)}`)
  })

  it("ignores a summary that arrives after the editor closes", async () => {
    const popup = await loadPopup({ selection: true, selectionText, deferSummary: true })
    popup.getElementById("generateSummary").click()
    popup.getElementById("cancel").click()
    popup.resolveSelectionSummary()
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), true)
    assert.equal(popup.getElementById("note").value, Lib.quoteSelection(selectionText))
  })

  it("shares summary controls with ordinary page saves while keeping the first page summary automatic", async () => {
    const popup = await loadPopup()
    assert.equal(popup.getElementById("summaryAi").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("summarySource").textContent, "Page")
    assert.equal(popup.getElementById("generateSummary").textContent, "Regenerate summary")
    assert.equal(popup.getElementById("note").value, "Page summary")
  })
})

describe("shared summary generation", () => {
  it("previews page regenerations and replaces an intact generated prefix while keeping the manual tail", async () => {
    const popup = await loadPopup({ deferPageSummary: true })
    const generate = popup.getElementById("generateSummary")
    const apply = popup.getElementById("applySummary")
    const note = popup.getElementById("note")
    assert.equal(generate.disabled, true)
    assert.equal(generate.textContent, "Summarizing…")
    popup.resolvePageSummary()
    assert.equal(note.value, "Page summary")

    for (const tail of ["", "\n\nMy manual note."]) {
      note.value = `Page summary${tail}`
      note.dispatch("input")
      generate.click()
      assert.equal(generate.disabled, true)
      assert.equal(generate.textContent, "Summarizing…")
      assert.equal(apply.disabled, true)
      generate.click()
      const sourceMessages = popup.messages.filter((message) => message.action === "summarize")
      assert.ok(
        sourceMessages.every(
          (message) =>
            message.tabId === 7 &&
            message.expectedUrl === "https://example.com/page" &&
            !Object.hasOwn(message, "text"),
        ),
      )
      popup.resolvePageSummary({ success: true, summary: "Regenerated page summary" })
      assert.equal(note.value, `Page summary${tail}`)
      assert.equal(popup.getElementById("summaryPreviewText").textContent, "Regenerated page summary")
      assert.equal(apply.textContent, "Replace summary")
      apply.click()
      assert.equal(note.value, `Regenerated page summary${tail}`)
      if (!tail) {
        generate.click()
        popup.resolvePageSummary()
        apply.click()
        assert.equal(note.value, "Page summary")
      }
    }
    assert.equal(popup.actions.filter((action) => action === "summarize").length, 4)
  })

  it("replaces an inserted selection summary without duplicating or altering the quote and manual tail", async () => {
    const popup = await loadPopup({ selection: true, deferSummary: true })
    const note = popup.getElementById("note")
    const quote = Lib.quoteSelection(defaultSelectionText)
    const generate = popup.getElementById("generateSummary")
    const apply = popup.getElementById("applySummary")
    generate.click()
    popup.resolveSelectionSummary({ success: true, summary: "First summary" })
    apply.click()
    const tail = `\n\n${quote}\n\nMy manual note.`
    note.value = `First summary${tail}`
    note.dispatch("input")
    generate.click()
    popup.resolveSelectionSummary({ success: true, summary: "Second summary" })
    assert.equal(note.value, `First summary${tail}`)
    assert.equal(apply.textContent, "Replace summary")
    apply.click()
    assert.equal(note.value, `Second summary${tail}`)
    assert.equal(note.value.split(quote).length - 1, 1)
    const sources = popup.messages.filter((message) => message.action === "summarizeSelection")
    assert.deepEqual(sources, [
      { action: "summarizeSelection", text: defaultSelectionText },
      { action: "summarizeSelection", text: defaultSelectionText },
    ])
  })

  for (const selection of [false, true]) {
    it(`adds a fresh ${selection ? "selection" : "page"} summary when the previously generated prefix was edited`, async () => {
      const popup = await loadPopup({ selection, deferSummary: true, deferPageSummary: true })
      const resolve = selection ? popup.resolveSelectionSummary : popup.resolvePageSummary
      const generate = popup.getElementById("generateSummary")
      const apply = popup.getElementById("applySummary")
      const note = popup.getElementById("note")
      if (selection) generate.click()
      resolve({ success: true, summary: "Original summary" })
      if (selection) apply.click()
      const edited = note.value.replace("Original summary", "Original summary (edited)") + "\n\nKeep my edits."
      note.value = edited
      note.dispatch("input")
      generate.click()
      resolve({ success: true, summary: "Fresh summary" })
      assert.equal(apply.textContent, "Add to note")
      assert.equal(note.value, edited)
      apply.click()
      assert.equal(note.value, `Fresh summary\n\n${edited}`)
    })
  }

  it("changes from replace to add if the user edits the generated prefix while a preview is ready", async () => {
    const popup = await loadPopup({ deferPageSummary: true })
    popup.resolvePageSummary()
    popup.getElementById("generateSummary").click()
    popup.resolvePageSummary({ success: true, summary: "Fresh preview" })
    const apply = popup.getElementById("applySummary")
    assert.equal(apply.textContent, "Replace summary")
    popup.getElementById("note").value = "My edited Page summary"
    popup.getElementById("note").dispatch("input")
    assert.equal(apply.textContent, "Add to note")
    apply.click()
    assert.equal(popup.getElementById("note").value, "Fresh preview\n\nMy edited Page summary")
  })

  it("keeps a good preview during regeneration and permits applying it after regeneration fails", async () => {
    const popup = await loadPopup({ selection: true, deferSummary: true })
    const generate = popup.getElementById("generateSummary")
    const apply = popup.getElementById("applySummary")
    generate.click()
    popup.resolveSelectionSummary({ success: true, summary: "Good preview" })
    generate.click()
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), false)
    assert.equal(popup.getElementById("summaryPreviewText").textContent, "Good preview")
    assert.equal(apply.disabled, true)
    popup.resolveSelectionSummary({ success: false, error: "Regeneration failed" })
    assert.equal(popup.getElementById("summaryStatus").textContent, "Regeneration failed")
    assert.equal(popup.getElementById("summaryPreviewText").textContent, "Good preview")
    assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), false)
    assert.equal(generate.textContent, "Regenerate summary")
    assert.equal(apply.disabled, false)
    apply.click()
    assert.equal(popup.getElementById("note").value, `Good preview\n\n${Lib.quoteSelection(defaultSelectionText)}`)
  })

  for (const edit of ["input event", "value change", "cleared input"]) {
    it(`previews the first page summary instead of overwriting a pending ${edit}`, async () => {
      const popup = await loadPopup({ deferPageSummary: true })
      const note = popup.getElementById("note")
      note.value = "My own draft."
      if (edit !== "value change") note.dispatch("input")
      if (edit === "cleared input") {
        note.value = ""
        note.dispatch("input")
      }
      const edited = note.value
      popup.resolvePageSummary()
      assert.equal(note.value, edited)
      assert.equal(popup.getElementById("summaryPreview").classList.contains("hidden"), false)
      assert.equal(popup.getElementById("summaryPreviewText").textContent, "Page summary")
      assert.equal(popup.getElementById("applySummary").textContent, "Add to note")
      popup.getElementById("applySummary").click()
      assert.equal(note.value, edited ? `Page summary\n\n${edited}` : "Page summary")
    })
  }

  it("shows the initial page model failure and retries through a preview without changing the note", async () => {
    const popup = await loadPopup({ deferPageSummary: true })
    const generate = popup.getElementById("generateSummary")
    popup.resolvePageSummary({ success: false, error: "Model unavailable" })
    assert.equal(popup.getElementById("summaryStatus").textContent, "Model unavailable")
    assert.equal(generate.disabled, false)
    assert.equal(generate.textContent, "Summarize")
    assert.equal(popup.getElementById("save").disabled, false)
    generate.click()
    popup.resolvePageSummary({ success: true, summary: "Recovered summary" })
    assert.equal(popup.getElementById("note").value, "")
    assert.equal(popup.getElementById("summaryStatus").textContent, "")
    assert.equal(popup.getElementById("summaryPreviewText").textContent, "Recovered summary")
    assert.equal(generate.textContent, "Regenerate summary")
    popup.getElementById("applySummary").click()
    assert.equal(popup.getElementById("note").value, "Recovered summary")
  })

  it("does not insert an initial page result after a save attempt fails and the editor remains open", async () => {
    const popup = await loadPopup({
      deferPageSummary: true,
      saveResponse: { success: false, error: "Save failed" },
    })
    popup.getElementById("save").click()
    const saved = popup.messages.find((message) => message.action === "addToOmnifocus")
    assert.equal(saved.customNote, "https://example.com/page")
    assert.equal(popup.getElementById("save").disabled, false)
    popup.resolvePageSummary()
    assert.equal(popup.getElementById("note").value, "")
    assert.equal(popup.getElementById("summaryPreviewText").textContent, "Page summary")
    assert.equal(popup.getElementById("applySummary").disabled, false)
    assert.equal(saved.customNote, "https://example.com/page")
  })

  for (const close of ["cancel", "save"]) {
    for (const error of [undefined, "Connection closed"]) {
      it(`does not mutate the page note after ${close} when the initial result ${error ? "fails" : "succeeds"}`, async () => {
        const popup = await loadPopup({ deferPageSummary: true })
        const note = popup.getElementById("note")
        popup.getElementById(close).click()
        const before = {
          note: note.value,
          preview: popup.getElementById("summaryPreviewText").textContent,
          status: popup.getElementById("summaryStatus").textContent,
        }
        popup.resolvePageSummary(undefined, error)
        assert.equal(note.value, before.note)
        if (close === "cancel") {
          assert.deepEqual(
            {
              note: note.value,
              preview: popup.getElementById("summaryPreviewText").textContent,
              status: popup.getElementById("summaryStatus").textContent,
            },
            before,
          )
        }
        assert.deepEqual(popup.uncheckedErrors, [])
        if (close === "save") {
          assert.equal(popup.messages.at(-1).customNote, "https://example.com/page")
          assert.equal(popup.getElementById("generateSummary").disabled, true)
          assert.equal(popup.getElementById("applySummary").disabled, true)
        }
      })
    }
  }
})

describe("embedded editor drag relay", () => {
  it("only starts dragging for the primary titlebar button and skips titlebar controls", async () => {
    const popup = await loadPopup({ selection: true })
    const title = { closest: () => null }
    const button = { closest: () => popup.getElementById("closeBox") }

    popup.titlebar.dispatch("mousedown", { button: 2, target: title, clientX: 20, clientY: 10 })
    popup.titlebar.dispatch("mousedown", { button: 1, target: title, clientX: 20, clientY: 10 })
    popup.titlebar.dispatch("mousedown", { button: 0, target: button, clientX: 20, clientY: 10 })
    assert.deepEqual(popup.parentMessages, [])

    popup.titlebar.dispatch("mousedown", { button: 0, target: title, clientX: 20, clientY: 10 })
    assert.deepEqual(popup.parentMessages, [{ __ofSaver: true, type: "drag-start", clientX: 20, clientY: 10 }])
  })

  it("relays an immediate release inside the iframe after its drag-start message", async () => {
    const popup = await loadPopup({ selection: true })
    popup.titlebar.dispatch("mousedown", {
      button: 0,
      target: { closest: () => null },
      clientX: 20,
      clientY: 10,
    })
    popup.document.dispatch("mouseup", { button: 0, buttons: 0 })

    assert.deepEqual(popup.parentMessages, [
      { __ofSaver: true, type: "drag-start", clientX: 20, clientY: 10 },
      { __ofSaver: true, type: "drag-end" },
    ])
  })

  for (const cancel of ["blur", "visibilitychange"]) {
    it(`relays drag-end when the iframe loses interaction through ${cancel}`, async () => {
      const popup = await loadPopup({ selection: true })
      popup.titlebar.dispatch("mousedown", {
        button: 0,
        target: { closest: () => null },
        clientX: 20,
        clientY: 10,
      })
      if (cancel === "blur") popup.window.dispatch("blur")
      else {
        popup.document.dispatch("visibilitychange")
        assert.equal(popup.parentMessages.length, 1)
        popup.document.hidden = true
        popup.document.dispatch("visibilitychange")
      }
      assert.deepEqual(popup.parentMessages.at(-1), { __ofSaver: true, type: "drag-end" })
    })
  }
})
