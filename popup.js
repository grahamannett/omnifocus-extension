document.addEventListener("DOMContentLoaded", async () => {
  const titleEl = document.getElementById("title")
  const hostEl = document.getElementById("host")
  const pathEl = document.getElementById("path")
  const projectRow = document.getElementById("projectRow")
  const projectSelect = document.getElementById("project")
  const tagsRow = document.getElementById("tagsRow")
  const tagsContainer = document.getElementById("tags")
  const suggestRow = document.getElementById("suggestRow")
  const suggestVal = document.getElementById("suggestVal")
  const flagBtn = document.getElementById("flag")
  const dueBtns = Array.from(document.querySelectorAll("button.preset[data-due]"))
  const noteLabelEl = document.getElementById("noteLabel")
  const noteLoadingEl = document.getElementById("noteLoading")
  const noteEl = document.getElementById("note")
  const statusEl = document.getElementById("status")
  const saveBtn = document.getElementById("save")
  const saveLinkOnlyBtn = document.getElementById("saveLinkOnly")
  const cancelBtn = document.getElementById("cancel")
  const closeBox = document.getElementById("closeBox")
  const popOutBtn = document.getElementById("popOut")
  const openOptionsLink = document.getElementById("openOptions")
  const whenValEl = document.getElementById("whenVal")

  // ── mode detection ──
  const params = new URLSearchParams(location.search)
  const embedded = params.get("embedded") === "1"
  const windowed = params.get("windowed") === "1"
  const passedTabId = Number.parseInt(params.get("tabId"), 10) || null
  if (windowed || embedded) popOutBtn.classList.add("invisible")

  // In embedded mode, route close/save-finish through postMessage to the parent
  // page so the modal can be removed.
  function closeMe() {
    if (embedded) {
      try {
        window.parent.postMessage({ __ofSaver: true, type: "close" }, "*")
      } catch {}
    } else {
      window.close()
    }
  }

  // Embedded: titlebar acts as drag handle. Forward mousedown to parent so it
  // can move the iframe wrapper. (Mouse events inside an iframe don't reach the
  // parent — postMessage bridges the gap.)
  if (embedded) {
    const titlebar = document.querySelector(".pop-titlebar")
    if (titlebar) {
      titlebar.style.cursor = "move"
      titlebar.addEventListener("mousedown", (e) => {
        if (e.target.closest("button")) return // skip clicks on close/grow boxes
        try {
          window.parent.postMessage(
            { __ofSaver: true, type: "drag-start", clientX: e.clientX, clientY: e.clientY },
            "*",
          )
        } catch {}
      })
    }
  }

  // ── theme load ──
  const { theme = "classic" } = await chrome.storage.sync.get(["theme"])
  document.body.dataset.theme = theme

  let currentTab = null

  // ── progress relay from offscreen during model download ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.target !== "popup") return
    if (msg.action === "summarizerProgress") {
      noteLabelEl.textContent = `Note · model dl ${msg.percent}%`
    }
  })

  // ── resolve tab (pop-out passes tabId; otherwise use last focused window) ──
  let tab = null
  if (passedTabId) {
    try {
      tab = await chrome.tabs.get(passedTabId)
    } catch {
      // tab was closed since pop-out — fall through to fallback
    }
  }
  if (!tab) {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    tab = t
  }
  currentTab = tab
  try {
    const u = new URL(tab.url)
    hostEl.textContent = u.host
    pathEl.textContent = (u.pathname + u.search) || "/"
  } catch {
    hostEl.textContent = tab.url || "—"
    pathEl.textContent = ""
  }

  // ── title autofill ──
  titleEl.value = tab.title || ""
  autoSizeTextarea(titleEl)
  titleEl.addEventListener("input", () => autoSizeTextarea(titleEl))

  // ── projects + tags from settings ──
  const { projects = [], tags = [], suggestMeta = true } = await chrome.storage.sync.get([
    "projects",
    "tags",
    "suggestMeta",
  ])

  if (projects.length) {
    projectRow.classList.remove("hidden")
    for (const p of projects) {
      const opt = document.createElement("option")
      opt.value = p
      opt.textContent = p
      projectSelect.appendChild(opt)
    }
    // Leave default at the empty "— Inbox —" option so unset = inbox.
  }

  // ── tags: chips for picked + Add dropdown for the rest ──
  const availableTags = tags
  let pickedTags = []
  const tagAddEl = document.getElementById("tagAdd")

  if (availableTags.length) {
    tagsRow.classList.remove("hidden")
    renderTagPicker()
  }

  function renderTagPicker() {
    // Strip existing chips, keep the select
    Array.from(tagsContainer.querySelectorAll("button.tag")).forEach((c) => c.remove())

    // Insert chips for picked tags (before the select)
    for (const t of pickedTags) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "tag on"
      chip.textContent = t
      chip.title = "Click to remove"
      chip.addEventListener("click", () => {
        pickedTags = pickedTags.filter((x) => x !== t)
        renderTagPicker()
      })
      tagsContainer.insertBefore(chip, tagAddEl)
    }

    // Rebuild dropdown options with the remaining tags
    tagAddEl.innerHTML = ""
    const placeholder = document.createElement("option")
    placeholder.value = ""
    placeholder.textContent = pickedTags.length === 0 ? "Add tag…" : "+ Add"
    tagAddEl.appendChild(placeholder)
    for (const t of availableTags) {
      if (pickedTags.includes(t)) continue
      const opt = document.createElement("option")
      opt.value = t
      opt.textContent = t
      tagAddEl.appendChild(opt)
    }
    tagAddEl.value = ""

    // Hide the dropdown if every tag is already picked
    tagAddEl.style.display = pickedTags.length < availableTags.length ? "" : "none"
  }

  tagAddEl.addEventListener("change", (e) => {
    const t = e.target.value
    if (!t) return
    pickedTags.push(t)
    renderTagPicker()
  })

  // ── flag toggle ──
  flagBtn.addEventListener("click", () => {
    flagBtn.classList.toggle("on")
    updateWhenRow()
  })

  // ── due-date single-select ──
  dueBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const wasOn = btn.classList.contains("on")
      dueBtns.forEach((b) => b.classList.remove("on"))
      if (!wasOn) btn.classList.add("on")
      updateWhenRow()
    })
  })

  function updateWhenRow() {
    const due = selectedDue()
    const flagged = flagBtn.classList.contains("on")
    if (!due && !flagged) {
      whenValEl.innerHTML = '<span class="placeholder">unscheduled</span>'
      return
    }
    const parts = []
    if (due) {
      parts.push(`<span class="date"><span class="lbl-inline">due</span>${due}</span>`)
    }
    if (flagged) {
      parts.push('<span class="flag-on">⚑ flagged</span>')
    }
    whenValEl.innerHTML = parts.join("")
  }

  // ── settings link ──
  openOptionsLink.addEventListener("click", (e) => {
    e.preventDefault()
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage()
    else window.open(chrome.runtime.getURL("options.html"))
  })

  // ── kick warmup + summarize in parallel ──
  chrome.runtime.sendMessage({ action: "checkAvailability" }, () => {
    if (chrome.runtime.lastError) return // ignore — we'll see the result via summarize
  })

  chrome.runtime.sendMessage({ action: "summarize", tabId: tab.id }, (resp) => {
    revealNoteEditor()
    if (chrome.runtime.lastError) {
      noteLabelEl.textContent = "note"
      return
    }
    if (resp?.success) {
      noteEl.value = resp.summary || ""
      autoSizeTextarea(noteEl)
      noteLabelEl.textContent = resp.summary ? "Note · summary" : "Note"
    } else {
      noteLabelEl.textContent = `Note · ${resp?.error || "ai unavailable"}`
    }
  })

  noteEl.addEventListener("input", () => autoSizeTextarea(noteEl))

  // ── AI project/tag suggestions (parallel with summary; never auto-applies) ──
  if (suggestMeta && (projects.length || availableTags.length)) {
    chrome.runtime.sendMessage({ action: "suggestMeta", tabId: tab.id }, (resp) => {
      if (chrome.runtime.lastError || !resp?.success) return // silent degrade, like summary
      renderSuggestions(resp.project, resp.tags)
    })
  }

  // ── helpers ──
  function autoSizeTextarea(el) {
    el.style.height = "auto"
    el.style.height = el.scrollHeight + "px"
  }

  function revealNoteEditor() {
    noteLoadingEl.style.display = "none"
    noteEl.hidden = false
  }

  function selectedTags() {
    return pickedTags.slice()
  }

  // Render AI suggestions as dashed "offer" chips. Nothing is applied until the
  // user clicks; an unclicked chip is simply ignored (save still goes to Inbox).
  function renderSuggestions(suggProject, suggTags) {
    suggestVal.innerHTML = ""

    const hideIfEmpty = () => {
      if (!suggestVal.children.length) suggestRow.classList.add("hidden")
    }

    // At most one project, and only if it's a real configured project.
    if (suggProject && projects.includes(suggProject)) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "tag suggest"
      chip.textContent = suggProject
      chip.title = "Click to set project"
      chip.addEventListener("click", () => {
        projectSelect.value = suggProject
        projectRow.classList.remove("hidden")
        chip.remove()
        hideIfEmpty()
      })
      suggestVal.appendChild(chip)
    }

    // Tags the model picked that exist and aren't already chosen.
    for (const t of Array.isArray(suggTags) ? suggTags : []) {
      if (!availableTags.includes(t) || pickedTags.includes(t)) continue
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "tag suggest"
      const at = document.createElement("span")
      at.className = "at"
      at.textContent = "@"
      chip.append(at, t)
      chip.title = "Click to add tag"
      chip.addEventListener("click", () => {
        if (!pickedTags.includes(t)) pickedTags.push(t)
        tagsRow.classList.remove("hidden")
        renderTagPicker()
        chip.remove()
        hideIfEmpty()
      })
      suggestVal.appendChild(chip)
    }

    if (suggestVal.children.length) suggestRow.classList.remove("hidden")
  }

  function selectedDue() {
    const active = dueBtns.find((b) => b.classList.contains("on"))
    if (!active) return null
    const today = new Date()
    if (active.dataset.due === "today") return formatISODate(today)
    if (active.dataset.due === "tomorrow") {
      const t = new Date(today)
      t.setDate(t.getDate() + 1)
      return formatISODate(t)
    }
    if (active.dataset.due === "week") {
      const t = new Date(today)
      t.setDate(t.getDate() + 7)
      return formatISODate(t)
    }
    return null
  }

  function formatISODate(d) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
  }

  function setError(msg) {
    statusEl.textContent = msg
    statusEl.classList.add("error")
  }

  function setStatus(msg) {
    statusEl.textContent = msg
    statusEl.classList.remove("error")
  }

  // ── save ──
  function send(includeNote) {
    setStatus("Saving…")
    saveBtn.disabled = true
    saveLinkOnlyBtn.disabled = true

    const summary = noteEl.value.trim()
    const note = includeNote && summary ? `${currentTab.url}\n\n${summary}` : currentTab.url

    chrome.runtime.sendMessage(
      {
        action: "addToOmnifocus",
        customTitle: titleEl.value.trim() || (currentTab.title || ""),
        customNote: note,
        project: projectSelect.value || null,
        tags: selectedTags(),
        flag: flagBtn.classList.contains("on"),
        due: selectedDue(),
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message)
          saveBtn.disabled = false
          saveLinkOnlyBtn.disabled = false
          return
        }
        if (resp?.success) {
          setStatus("Saved")
          setTimeout(closeMe, 600)
        } else {
          setError(resp?.error || "Failed to save")
          saveBtn.disabled = false
          saveLinkOnlyBtn.disabled = false
        }
      },
    )
  }

  saveBtn.addEventListener("click", () => send(true))
  saveLinkOnlyBtn.addEventListener("click", () => send(false))
  cancelBtn.addEventListener("click", closeMe)
  closeBox.addEventListener("click", closeMe)

  popOutBtn.addEventListener("click", async () => {
    if (windowed || embedded) return
    const tabId = currentTab?.id
    const url = currentTab?.url || ""
    if (!tabId || !/^https?:\/\//i.test(url)) {
      setError("Pop-out only works on http(s) pages")
      return
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: injectModal,
        args: [tabId, chrome.runtime.getURL("popup.html")],
      })
      window.close()
    } catch (err) {
      setError(`Pop-out failed: ${err.message}`)
    }
  })

  // ── keyboard ──
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMe()
      return
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send(true)
    }
  })
})

// Runs in the page's content script context (passed to chrome.scripting.executeScript).
// Defines the in-page draggable modal that hosts an iframe of the popup.
function injectModal(tabId, popupUrl) {
  const HOST_ID = "__omnifocus-saver-modal__"
  const existing = document.getElementById(HOST_ID)
  if (existing) {
    existing.remove()
    return
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
  iframe.src = `${popupUrl}?embedded=1&tabId=${tabId}`
  Object.assign(iframe.style, {
    width: "100%",
    height: "100%",
    border: "0",
    display: "block",
    background: "#fff",
  })

  host.appendChild(iframe)
  ;(document.body || document.documentElement).appendChild(host)

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
}
