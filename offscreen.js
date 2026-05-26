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

// Prompt API (LanguageModel) — classifies a saved page into the user's existing
// projects/tags. Restraint is deliberate: most saves should fall through to the Inbox.
const CLASSIFIER_SYSTEM_PROMPT = [
  "You file a saved web page into the user's existing OmniFocus projects and tags.",
  "",
  "Rules:",
  "- Choose AT MOST ONE project, and only when the page clearly and strongly belongs to it.",
  '  If no project is a strong match, return an empty string for "project" (the task goes to the Inbox).',
  "- Choose zero or more tags that clearly apply.",
  "- Use ONLY the exact project and tag names given in the user message. Never invent names.",
  "- Prefer fewer, high-confidence choices over guessing. When unsure, leave it empty.",
  "",
  "Respond with JSON only.",
].join("\n")

let classifierPromise = null

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

// Cached base session holding only the system prompt; we clone() it per request so
// each classification is stateless (mirrors getSummarizer's lazy/cached pattern).
async function getClassifier() {
  if (classifierPromise) return classifierPromise
  if (!("LanguageModel" in self)) {
    throw new Error("Prompt API unavailable")
  }
  classifierPromise = (async () => {
    const availability = await LanguageModel.availability()
    if (availability === "unavailable") {
      throw new Error("Prompt API unavailable on this device")
    }
    return LanguageModel.create({
      initialPrompts: [{ role: "system", content: CLASSIFIER_SYSTEM_PROMPT }],
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => {
          const percent = Math.round((e.loaded ?? 0) * 100)
          console.log(`[offscreen] LanguageModel download: ${percent}%`)
          broadcastProgress(percent)
        })
      },
    })
  })().catch((err) => {
    classifierPromise = null
    throw err
  })
  return classifierPromise
}

// JSON-schema constraint that pins the model's output to the user's exact names.
// "" is the Inbox sentinel; empty lists collapse to "no choice" rather than an
// empty enum (which some schema validators reject).
function buildResponseConstraint(projects, tags) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["project", "tags"],
    properties: {
      project: { type: "string", enum: projects.length ? ["", ...projects] : [""] },
      tags: tags.length ? { type: "array", items: { type: "string", enum: tags } } : { type: "array", maxItems: 0 },
    },
  }
}

function buildClassifyPrompt(text, title, url, projects, tags) {
  const list = (arr) => (arr.length ? arr.map((x) => `- ${x}`).join("\n") : "(none)")
  return [
    `Page title: ${title || "(untitled)"}`,
    `URL: ${url || "(unknown)"}`,
    "",
    "Content:",
    text || "(no extractable text)",
    "",
    "Available projects:",
    list(projects),
    "",
    "Available tags:",
    list(tags),
  ].join("\n")
}

async function classify({ text, title, url, projects, tags }) {
  const projectList = Array.isArray(projects) ? projects : []
  const tagList = Array.isArray(tags) ? tags : []
  const base = await getClassifier()

  // Fresh per-call session so turns never accumulate on the cached base.
  let session
  try {
    session = await base.clone()
  } catch {
    session = await LanguageModel.create({
      initialPrompts: [{ role: "system", content: CLASSIFIER_SYSTEM_PROMPT }],
    })
  }

  try {
    const raw = await session.prompt(buildClassifyPrompt(text, title, url, projectList, tagList), {
      responseConstraint: buildResponseConstraint(projectList, tagList),
    })
    const parsed = JSON.parse(raw)

    // Defensive: only ever emit names that exist (or "" → Inbox), even if the
    // model or the constraint slips.
    const projectSet = new Set(projectList)
    const tagSet = new Set(tagList)
    const project = typeof parsed.project === "string" && projectSet.has(parsed.project) ? parsed.project : ""
    const outTags = Array.isArray(parsed.tags) ? [...new Set(parsed.tags.filter((t) => tagSet.has(t)))] : []
    return { project, tags: outTags }
  } finally {
    session?.destroy?.()
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
        // Best-effort: warm the classifier too (shares Gemini Nano — no extra download).
        // Fire-and-forget so a Prompt API hiccup never fails summarizer warmup.
        getClassifier().catch(() => {})
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

  if (msg.action === "classify") {
    ;(async () => {
      try {
        const { project, tags } = await classify(msg)
        sendResponse({ ok: true, project, tags })
      } catch (err) {
        sendResponse({ ok: false, error: err.message })
      }
    })()
    return true
  }
})

console.log("[offscreen] loaded")
