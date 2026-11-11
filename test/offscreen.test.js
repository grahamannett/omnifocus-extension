const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const scripts = ["lib.js", "offscreen.js"].map((filename) => ({
  filename,
  source: fs.readFileSync(path.join(__dirname, "..", filename), "utf8"),
}))

function loadOffscreen(create, { availability = async () => "available", languageModel } = {}) {
  let listener
  let nextTimer = 0
  const timers = new Map()
  const context = vm.createContext({
    console: { log() {} },
    AbortController,
    setTimeout(callback, ms) {
      const id = ++nextTimer
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    Summarizer: {
      availability,
      create,
    },
    ...(languageModel ? { LanguageModel: languageModel } : {}),
    chrome: {
      runtime: {
        sendMessage: async () => {},
        onMessage: {
          addListener(callback) {
            listener = callback
          },
        },
      },
    },
  })
  context.self = context
  for (const { filename, source } of scripts) {
    vm.runInContext(source, context, { filename })
  }

  const request = (message, onResponse = () => {}) =>
    new Promise((resolve, reject) => {
      const keepAlive = listener({ target: "offscreen", ...message }, {}, (response) => {
        try {
          onResponse()
          resolve(structuredClone(response))
        } catch (err) {
          reject(err)
        }
      })
      if (keepAlive !== true) reject(new Error("Offscreen did not keep the response channel open"))
    })
  request.expireDeadline = () => {
    const [id, timer] = [...timers.entries()].find(([, timer]) => timer.ms === 60000) || []
    assert.ok(timer, "a 60-second isolated summary deadline should be active")
    timers.delete(id)
    timer.callback()
  }
  request.pendingTimers = () => timers.size
  return request
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const text = "An article with enough text to pass the model input preparation limit."

describe("offscreen summarizer lifetime", () => {
  it("releases a successful lab session before responding", async () => {
    let activeSessions = 0
    let activeAtResponse
    const request = loadOffscreen(async () => {
      activeSessions++
      return {
        async summarize() {
          return "  A summary.  "
        },
        destroy() {
          activeSessions--
        },
      }
    })

    const response = await request({ action: "summarize", text, options: {} }, () => {
      activeAtResponse = activeSessions
    })

    assert.deepEqual(response, { ok: true, summary: "A summary." })
    assert.equal(activeAtResponse, 0)
  })

  it("releases a rejected lab inference before responding with the error", async () => {
    let activeSessions = 0
    let activeAtResponse
    const request = loadOffscreen(async () => {
      activeSessions++
      return {
        async summarize() {
          throw new Error("Inference failed")
        },
        destroy() {
          activeSessions--
        },
      }
    })

    const response = await request({ action: "summarize", text, options: {} }, () => {
      activeAtResponse = activeSessions
    })

    assert.deepEqual(response, { ok: false, error: "Inference failed" })
    assert.equal(activeAtResponse, 0)
  })

  it("allows a later lab run after creation rejects, without destroying an unacquired session", async () => {
    let attempts = 0
    let releases = 0
    const request = loadOffscreen(async () => {
      attempts++
      if (attempts === 1) throw new Error("Creation failed")
      return {
        async summarize() {
          return "Recovered."
        },
        destroy() {
          releases++
        },
      }
    })

    const failed = await request({ action: "summarize", text, options: {} })
    assert.deepEqual(failed, { ok: false, error: "Creation failed" })
    assert.equal(releases, 0)

    const recovered = await request({ action: "summarize", text, options: {} })
    assert.deepEqual(recovered, { ok: true, summary: "Recovered." })
    assert.equal(attempts, 2)
    assert.equal(releases, 1)
  })

  it("acquires and releases independent sessions for identical lab options", async () => {
    let nextId = 0
    const active = new Set()
    const released = []
    const activeAtResponse = []
    const request = loadOffscreen(async () => {
      const id = ++nextId
      active.add(id)
      return {
        async summarize() {
          if (!active.has(id)) throw new Error("Session was already destroyed")
          return `Session ${id}`
        },
        destroy() {
          if (!active.delete(id)) throw new Error("Session was destroyed twice")
          released.push(id)
        },
      }
    })
    const options = { type: "key-points", length: "long" }
    const observeResponse = () => activeAtResponse.push(active.size)

    const first = await request({ action: "summarize", text, options }, observeResponse)
    const second = await request({ action: "summarize", text, options }, observeResponse)

    assert.deepEqual(first, { ok: true, summary: "Session 1" })
    assert.deepEqual(second, { ok: true, summary: "Session 2" })
    assert.deepEqual(released, [1, 2])
    assert.deepEqual(activeAtResponse, [0, 0])
  })

  it("keeps production reusable after a lab failure with the same resolved options", async () => {
    let creations = 0
    const active = new Set()
    const released = []
    const request = loadOffscreen(async () => {
      const id = ++creations
      active.add(id)
      return {
        async summarize() {
          if (!active.has(id)) throw new Error("Session was already destroyed")
          if (id === 2) throw new Error("Lab inference failed")
          return "Production summary."
        },
        destroy() {
          if (!active.delete(id)) throw new Error("Session was destroyed twice")
          released.push(id)
        },
      }
    })

    const first = await request({ action: "summarize", text, options: null })
    assert.deepEqual(first, { ok: true, summary: "Production summary." })
    const failed = await request({ action: "summarize", text, options: {} })
    assert.deepEqual(failed, { ok: false, error: "Lab inference failed" })
    const next = await request({ action: "summarize", text, options: null })

    assert.deepEqual(next, { ok: true, summary: "Production summary." })
    assert.equal(creations, 2)
    assert.deepEqual(released, [2])
    assert.deepEqual([...active], [1])
  })

  it("retries production creation after rejection and then reuses the recovered session", async () => {
    let attempts = 0
    let releases = 0
    const request = loadOffscreen(async () => {
      attempts++
      if (attempts === 1) throw new Error("Production creation failed")
      return {
        async summarize() {
          return "Recovered production."
        },
        destroy() {
          releases++
        },
      }
    })

    const failed = await request({ action: "summarize", text, options: null })
    assert.deepEqual(failed, { ok: false, error: "Production creation failed" })
    const recovered = await request({ action: "summarize", text, options: null })
    const reused = await request({ action: "summarize", text, options: null })

    assert.deepEqual(recovered, { ok: true, summary: "Recovered production." })
    assert.deepEqual(reused, recovered)
    assert.equal(attempts, 2)
    assert.equal(releases, 0)
  })

  it("shares one pending production creation between warmup and inference", { timeout: 1000 }, async () => {
    let releaseCreation
    let markCreationStarted
    const creationGate = new Promise((resolve) => {
      releaseCreation = resolve
    })
    const creationStarted = new Promise((resolve) => {
      markCreationStarted = resolve
    })
    let creations = 0
    let releases = 0
    const request = loadOffscreen(async () => {
      creations++
      markCreationStarted()
      await creationGate
      return {
        async summarize() {
          return "Shared production."
        },
        destroy() {
          releases++
        },
      }
    })

    const warming = request({ action: "warmup" })
    const summarizing = request({ action: "summarize", text, options: null })
    await creationStarted
    releaseCreation()
    const [warmup, summary] = await Promise.all([warming, summarizing])
    const reused = await request({ action: "summarize", text })

    assert.deepEqual(warmup, { ok: true, availability: "available" })
    assert.deepEqual(summary, { ok: true, summary: "Shared production." })
    assert.deepEqual(reused, summary)
    assert.equal(creations, 1)
    assert.equal(releases, 0)
  })

  it("reports cleanup failure instead of returning an apparently successful lab run", async () => {
    const events = []
    const request = loadOffscreen(async () => ({
      async summarize() {
        events.push("inference")
        return "A summary that cannot be reported as success."
      },
      destroy() {
        events.push("destroy")
        throw new Error("Cleanup failed")
      },
    }))

    const response = await request({ action: "summarize", text, options: {} }, () => {
      events.push("response")
    })

    assert.deepEqual(response, { ok: false, error: "Cleanup failed" })
    assert.deepEqual(events, ["inference", "destroy", "response"])
  })

  it(
    "aborts a stuck lab inference, releases it before responding, and permits recovery",
    { timeout: 1000 },
    async () => {
      const inferenceStarted = deferred()
      let signal
      let releases = 0
      let creations = 0
      const request = loadOffscreen(async (createOptions) => {
        creations++
        const id = creations
        assert.ok(createOptions.signal instanceof AbortSignal)
        return {
          async summarize(_text, options) {
            assert.equal(options.signal, createOptions.signal)
            if (id > 1) return "Recovered lab."
            signal = options.signal
            inferenceStarted.resolve()
            return new Promise((_, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), { once: true })
            })
          },
          destroy() {
            releases++
          },
        }
      })

      const stuck = request({ action: "summarize", text, options: {} }, () => assert.equal(releases, 1))
      await inferenceStarted.promise
      request.expireDeadline()
      assert.deepEqual(await stuck, { ok: false, error: "Summary timed out" })
      assert.equal(signal.aborted, true)
      assert.equal(releases, 1)
      assert.equal(request.pendingTimers(), 0)

      assert.deepEqual(await request({ action: "summarize", text, options: {} }), {
        ok: true,
        summary: "Recovered lab.",
      })
      assert.equal(releases, 2)
      assert.equal(request.pendingTimers(), 0)
    },
  )

  it(
    "releases a session acquired after the lab creation deadline without running inference",
    { timeout: 1000 },
    async () => {
      const creationStarted = deferred()
      const creation = deferred()
      const destroyed = deferred()
      let signal
      let inferences = 0
      let releases = 0
      const request = loadOffscreen((options) => {
        signal = options.signal
        creationStarted.resolve()
        return creation.promise
      })
      const pending = request({ action: "summarize", text, options: {} })
      await creationStarted.promise
      request.expireDeadline()
      assert.deepEqual(await pending, { ok: false, error: "Summary timed out" })
      assert.equal(signal.aborted, true)
      creation.resolve({
        summarize() {
          inferences++
        },
        destroy() {
          releases++
          destroyed.resolve()
        },
      })
      await destroyed.promise
      assert.equal(inferences, 0)
      assert.equal(releases, 1)
      assert.equal(request.pendingTimers(), 0)
    },
  )

  it("does not create a lab session when availability finishes after its deadline", { timeout: 1000 }, async () => {
    const availabilityStarted = deferred()
    const availability = deferred()
    let creations = 0
    const request = loadOffscreen(
      async () => {
        creations++
      },
      {
        availability(options) {
          assert.equal("signal" in options, false, "availability does not accept AbortSignal")
          availabilityStarted.resolve()
          return availability.promise
        },
      },
    )
    const pending = request({ action: "summarize", text, options: {} })
    await availabilityStarted.promise
    request.expireDeadline()
    assert.deepEqual(await pending, { ok: false, error: "Summary timed out" })
    availability.resolve("available")
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(creations, 0)
    assert.equal(request.pendingTimers(), 0)
  })

  it("keeps production reusable when a lab inference ignores abort and finishes late", { timeout: 1000 }, async () => {
    const inferenceStarted = deferred()
    const lateInference = deferred()
    let creations = 0
    const active = new Set()
    const releases = []
    const request = loadOffscreen(async () => {
      const id = ++creations
      active.add(id)
      return {
        async summarize() {
          if (id === 2) {
            inferenceStarted.resolve()
            return lateInference.promise
          }
          return "Production summary."
        },
        destroy() {
          assert.ok(active.delete(id), "each session should be destroyed only once")
          releases.push(id)
        },
      }
    })
    const production = await request({ action: "summarize", text })
    const pending = request({ action: "summarize", text, options: {} })
    await inferenceStarted.promise
    request.expireDeadline()
    assert.deepEqual(await pending, { ok: false, error: "Summary timed out" })
    assert.deepEqual(releases, [2])
    assert.deepEqual(await request({ action: "summarize", text }), production)
    lateInference.resolve("Late lab result.")
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(releases, [2])
    assert.deepEqual([...active], [1])
    assert.equal(creations, 2)
  })
})

describe("offscreen classifier integration", () => {
  it("declares classifier input and output languages during warmup and reuses them for inference", async () => {
    const availabilityOptions = []
    const creationOptions = []
    const warnings = []
    let clones = 0
    const request = loadOffscreen(async () => ({}), {
      languageModel: {
        async availability(options) {
          availabilityOptions.push(structuredClone(options))
          return "available"
        },
        async create(options) {
          creationOptions.push(
            structuredClone({
              expectedInputs: options.expectedInputs,
              expectedOutputs: options.expectedOutputs,
            }),
          )
          return {
            async clone() {
              clones++
              return {
                async prompt() {
                  if (!options.expectedOutputs?.some((output) => output.type === "text" && output.languages?.length)) {
                    warnings.push("No output language was specified in a LanguageModel API request.")
                  }
                  return JSON.stringify({ project: "", tags: [] })
                },
                destroy() {},
              }
            },
          }
        },
      },
    })

    assert.deepEqual(await request({ action: "warmup" }), { ok: true, availability: "available" })
    const message = { action: "classify", text, projects: [], tags: [] }
    assert.deepEqual(await request(message), { ok: true, project: "", tags: [] })
    assert.deepEqual(await request(message), { ok: true, project: "", tags: [] })
    assert.deepEqual(warnings, [])
    const expected = {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    }
    assert.deepEqual(availabilityOptions, [expected])
    assert.deepEqual(creationOptions, [expected])
    assert.equal(clones, 2)
  })

  it("reuses its base, releases each clone, and filters model output to configured names", async () => {
    let creations = 0
    let clones = 0
    let releases = 0
    const request = loadOffscreen(async () => {}, {
      languageModel: {
        availability: async () => "available",
        async create(options) {
          creations++
          assert.equal(options.initialPrompts[0].role, "system")
          return {
            async clone() {
              clones++
              return {
                async prompt(prompt, options) {
                  assert.ok(prompt.includes("Source article"))
                  assert.deepEqual(structuredClone(options.responseConstraint.properties.project.enum), ["", "Reading"])
                  return JSON.stringify({ project: "Invented project", tags: ["Article", "Unknown", "Article"] })
                },
                destroy() {
                  releases++
                },
              }
            },
          }
        },
      },
    })
    const message = { action: "classify", text, title: "Source article", projects: ["Reading"], tags: ["Article"] }
    assert.deepEqual(await request(message), { ok: true, project: "", tags: ["Article"] })
    assert.deepEqual(await request(message), { ok: true, project: "", tags: ["Article"] })
    assert.equal(creations, 1)
    assert.equal(clones, 2)
    assert.equal(releases, 2)
  })

  it("releases the fallback classifier session when cloning fails and inference rejects", async () => {
    let creations = 0
    let releases = 0
    const request = loadOffscreen(async () => {}, {
      languageModel: {
        availability: async () => "available",
        async create(options) {
          creations++
          assert.equal(options.initialPrompts[0].role, "system")
          assert.deepEqual(structuredClone(options.expectedInputs), [{ type: "text", languages: ["en"] }])
          assert.deepEqual(structuredClone(options.expectedOutputs), [{ type: "text", languages: ["en"] }])
          if (creations === 1)
            return {
              async clone() {
                throw new Error("Clone unavailable")
              },
            }
          return {
            async prompt() {
              throw new Error("Classification failed")
            },
            destroy() {
              releases++
            },
          }
        },
      },
    })
    assert.deepEqual(await request({ action: "classify", text, projects: [], tags: [] }), {
      ok: false,
      error: "Classification failed",
    })
    assert.equal(creations, 2)
    assert.equal(releases, 1)
  })
})
