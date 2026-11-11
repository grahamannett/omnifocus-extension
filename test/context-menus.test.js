const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const menuIds = ["of-add-selection", "of-quick-save-selection", "of-edit-selection"]

function menuBrowser({ removeError, createErrors = {} } = {}) {
  const items = new Map()
  const calls = []
  const uncheckedErrors = []
  const warnings = []
  const operations = []
  const callbacks = []

  function loadWorker() {
    const listeners = {}
    let lastError
    let errorChecked
    const runtime = {
      get lastError() {
        errorChecked = true
        return lastError
      },
      getURL: (filename) => `chrome-extension://extension/${filename}`,
      sendMessage: async () => ({ ok: true }),
      onMessage: { addListener() {} },
      onInstalled: { addListener: (callback) => (listeners.installed = callback) },
      onStartup: { addListener: (callback) => (listeners.startup = callback) },
    }
    function deliver(callback, message) {
      lastError = message ? { message } : undefined
      errorChecked = false
      try {
        callback?.()
      } finally {
        if (message && !errorChecked) uncheckedErrors.push(`Unchecked runtime.lastError: ${message}`)
        lastError = undefined
      }
    }
    const context = vm.createContext({
      console: { log() {}, warn: (...args) => warnings.push(args.join(" ")), error() {} },
      URL,
      setTimeout,
      clearTimeout,
      chrome: {
        runtime,
        commands: { onCommand: { addListener() {} } },
        offscreen: { hasDocument: async () => true },
        storage: { session: { remove: async () => {} } },
        contextMenus: {
          removeAll(callback) {
            calls.push({ method: "removeAll" })
            const result = new Promise((resolve, reject) => {
              operations.push(() => {
                if (!removeError) items.clear()
                callbacks.push(() => {
                  if (callback) {
                    deliver(callback, removeError)
                    resolve()
                  } else if (removeError) reject(new Error(removeError))
                  else resolve()
                })
              })
            })
            return callback ? undefined : result
          },
          create(properties, callback) {
            calls.push({ method: "create", id: properties.id })
            operations.push(() => {
              const message =
                createErrors[properties.id] ||
                (items.has(properties.id) && `Cannot create item with duplicate id ${properties.id}`) ||
                (properties.parentId && !items.has(properties.parentId) && "Cannot find parent menu item")
              if (!message) items.set(properties.id, structuredClone(properties))
              callbacks.push(() => deliver(callback, message))
            })
            return properties.id
          },
          onClicked: { addListener() {} },
        },
      },
    })
    context.self = context
    context.importScripts = (...filenames) => {
      for (const filename of filenames) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, "..", filename), "utf8"), context, { filename })
      }
    }
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../background.js"), "utf8"), context)
    return {
      install: () => listeners.installed(),
      startup: () => listeners.startup(),
    }
  }

  async function flush() {
    // Chrome applies API operations asynchronously; removal callbacks can both
    // run after their removals, allowing overlapping rebuilds to create duplicates.
    for (let pass = 0; pass < 30; pass++) {
      while (operations.length) operations.shift()()
      while (callbacks.length) callbacks.shift()()
      await new Promise(setImmediate)
      if (!operations.length && !callbacks.length) return
    }
    assert.fail("context menu operations did not settle")
  }

  return { items, calls, uncheckedErrors, warnings, loadWorker, flush }
}

describe("context menu registration", () => {
  it("does not race worker loading with installation", async () => {
    const browser = menuBrowser()
    browser.loadWorker().install()
    await browser.flush()

    assert.deepEqual(browser.uncheckedErrors, [])
    assert.deepEqual([...browser.items.keys()], menuIds)
    assert.equal(browser.calls.filter((call) => call.method === "removeAll").length, 1)
    assert.equal(browser.calls.filter((call) => call.method === "create").length, 3)
    for (const id of menuIds) assert.deepEqual(browser.items.get(id).contexts, ["selection"])
    for (const id of menuIds.slice(1)) assert.equal(browser.items.get(id).parentId, menuIds[0])
  })

  it("preserves persisted menus when the worker wakes and Chrome starts", async () => {
    const browser = menuBrowser()
    browser.loadWorker().install()
    await browser.flush()
    const previousCalls = browser.calls.length
    const previousItems = [...browser.items]

    const worker = browser.loadWorker()
    worker.startup()
    await browser.flush()

    assert.equal(browser.calls.length, previousCalls)
    assert.deepEqual([...browser.items], previousItems)
    assert.deepEqual(browser.uncheckedErrors, [])
  })

  it("rebuilds existing menu items on extension update", async () => {
    const browser = menuBrowser()
    browser.loadWorker().install()
    await browser.flush()
    browser.items.get(menuIds[0]).title = "Outdated title"
    browser.items.set("obsolete-menu", { id: "obsolete-menu" })

    browser.loadWorker().install()
    await browser.flush()

    assert.equal(browser.items.get(menuIds[0]).title, "Clip to OmniFocus")
    assert.deepEqual([...browser.items.keys()], menuIds)
    assert.deepEqual(browser.uncheckedErrors, [])
  })

  it("stops after menu removal fails instead of recreating existing IDs", async () => {
    const browser = menuBrowser({ removeError: "Removal failed" })
    browser.items.set(menuIds[0], { id: menuIds[0] })
    browser.loadWorker().install()
    await browser.flush()

    assert.equal(browser.calls.filter((call) => call.method === "create").length, 0)
    assert.deepEqual(browser.uncheckedErrors, [])
    assert.ok(browser.warnings.some((warning) => warning.includes("Removal failed")))
  })

  it("handles asynchronous parent creation errors before attempting children", async () => {
    const browser = menuBrowser({ createErrors: { [menuIds[0]]: "Parent creation failed" } })
    browser.loadWorker().install()
    await browser.flush()

    assert.deepEqual(
      browser.calls.filter((call) => call.method === "create").map((call) => call.id),
      [menuIds[0]],
    )
    assert.deepEqual(browser.uncheckedErrors, [])
    assert.ok(
      browser.warnings.some((warning) => warning.includes(menuIds[0]) && warning.includes("Parent creation failed")),
    )
  })

  it("handles asynchronous submenu creation errors with the failing item ID", async () => {
    const browser = menuBrowser({ createErrors: { [menuIds[1]]: "Submenu creation failed" } })
    browser.loadWorker().install()
    await browser.flush()

    assert.deepEqual(browser.uncheckedErrors, [])
    assert.ok(
      browser.warnings.some((warning) => warning.includes(menuIds[1]) && warning.includes("Submenu creation failed")),
    )
  })
})
