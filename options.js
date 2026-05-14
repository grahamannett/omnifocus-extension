const projectsEl = document.getElementById("projects")
const tagsEl = document.getElementById("tags")
const statusEl = document.getElementById("status")
const saveBtn = document.getElementById("save")
const resetBtn = document.getElementById("reset")
const syncProjectsBtn = document.getElementById("syncProjects")
const syncTagsBtn = document.getElementById("syncTags")
const pasteProjectsBtn = document.getElementById("pasteProjects")
const pasteTagsBtn = document.getElementById("pasteTags")
const themeRadios = Array.from(document.querySelectorAll('input[name="theme"]'))

const SYNC_SENTINEL = "##OFSYNC:"

let pendingSync = null // 'projects' | 'tags' | null

// Matches the sync sentinel for either kind, with either a real newline or
// the legacy literal "\n" form.
const SENTINEL_ANY_RE = new RegExp(`^${SYNC_SENTINEL}(?:projects|tags)##(?:\\\\n|\\n)`)

function stripAnySentinel(text) {
  return text.replace(SENTINEL_ANY_RE, "")
}

function parseList(text) {
  return stripAnySentinel(text)
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !SENTINEL_ANY_RE.test(s + "\n"))
}

function flash(msg, ok = true) {
  statusEl.textContent = msg
  statusEl.style.color = ok ? "#2a8c4a" : "#c0392b"
  setTimeout(() => (statusEl.textContent = ""), 4000)
}

async function load() {
  const { projects = [], tags = [], theme = "classic" } = await chrome.storage.sync.get(["projects", "tags", "theme"])
  projectsEl.value = projects.join("\n")
  tagsEl.value = tags.join("\n")
  applyTheme(theme)
  for (const r of themeRadios) r.checked = r.value === theme
}

function applyTheme(theme) {
  document.body.dataset.theme = theme
}

async function setTheme(theme) {
  applyTheme(theme)
  await chrome.storage.sync.set({ theme })
  flash(`Theme: ${theme === "sea" ? "Pale Sea" : "Classic"}`)
}

async function save() {
  const projects = parseList(projectsEl.value)
  const tags = parseList(tagsEl.value)
  await chrome.storage.sync.set({ projects, tags })
  flash(`Saved (${projects.length} projects, ${tags.length} tags)`)
}

function buildSyncScript(kind) {
  const collection = kind === "projects" ? "flattenedProjects" : "flattenedTags"
  // Real newline; JSON.stringify will escape it to \n in the JS source we send.
  const sentinel = `${SYNC_SENTINEL}${kind}##\n`
  return `
    (() => {
      const names = ${collection}.map(x => x.name).filter(Boolean);
      Pasteboard.general.string = ${JSON.stringify(sentinel)} + names.join("\\n");
    })();
  `
    .trim()
    .replace(/\s+/g, " ")
}

function startSync(kind) {
  pendingSync = kind
  const script = buildSyncScript(kind)
  const url = `omnifocus://x-callback-url/omnijs-run?script=${encodeURIComponent(script)}`
  const a = document.createElement("a")
  a.href = url
  a.target = "_blank"
  a.rel = "noopener"
  a.click()
  flash(`Approve and run the script in OmniFocus, then click "Paste from clipboard".`)
}

function stripSentinel(text, kind) {
  // Match either the correct sentinel ("##OFSYNC:projects##\n") or the legacy
  // broken form ("##OFSYNC:projects##\\n" with literal backslash-n) so any
  // pre-fix clipboard contents also parse cleanly.
  const re = new RegExp(`^${SYNC_SENTINEL}${kind}##(?:\\\\n|\\n)`)
  return text.replace(re, "").trim()
}

async function pasteFrom(kind) {
  let text
  try {
    text = await navigator.clipboard.readText()
  } catch (err) {
    flash(`Couldn't read clipboard: ${err.message}`, false)
    return
  }
  if (!text || !text.trim()) {
    flash("Clipboard is empty.", false)
    return
  }
  const cleaned = stripSentinel(text, kind)
  const target = kind === "projects" ? projectsEl : tagsEl
  target.value = cleaned
  const count = parseList(cleaned).length
  flash(`Pasted ${count} ${kind} from clipboard`)
  await save()
  pendingSync = null
}

async function tryAutoPasteOnFocus() {
  if (!pendingSync) return
  let text
  try {
    text = await navigator.clipboard.readText()
  } catch {
    return // silent — user will use the manual button
  }
  const re = new RegExp(`^${SYNC_SENTINEL}${pendingSync}##(?:\\\\n|\\n)`)
  if (!re.test(text)) return
  const list = text.replace(re, "").trim()
  const target = pendingSync === "projects" ? projectsEl : tagsEl
  target.value = list
  flash(`Auto-pasted ${parseList(list).length} ${pendingSync}`)
  await save()
  pendingSync = null
}

saveBtn.addEventListener("click", save)
resetBtn.addEventListener("click", async () => {
  await chrome.storage.sync.remove(["projects", "tags"])
  await load()
  flash("Cleared")
})
syncProjectsBtn.addEventListener("click", () => startSync("projects"))
syncTagsBtn.addEventListener("click", () => startSync("tags"))
pasteProjectsBtn.addEventListener("click", () => pasteFrom("projects"))
pasteTagsBtn.addEventListener("click", () => pasteFrom("tags"))

for (const r of themeRadios) {
  r.addEventListener("change", () => {
    if (r.checked) setTheme(r.value)
  })
}

function handleManualPaste(e) {
  const pasted = e.clipboardData?.getData("text") ?? ""
  if (!SENTINEL_ANY_RE.test(pasted)) return
  e.preventDefault()
  const cleaned = stripAnySentinel(pasted).trim()
  const ta = e.currentTarget
  const start = ta.selectionStart
  const end = ta.selectionEnd
  ta.value = ta.value.slice(0, start) + cleaned + ta.value.slice(end)
  const caret = start + cleaned.length
  ta.setSelectionRange(caret, caret)
}

projectsEl.addEventListener("paste", handleManualPaste)
tagsEl.addEventListener("paste", handleManualPaste)

window.addEventListener("focus", tryAutoPasteOnFocus)

load()
