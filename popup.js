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
  const suggestStatusEl = document.getElementById("suggestStatus")
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
  const summaryAiEl = document.getElementById("summaryAi")
  const summarySourceEl = document.getElementById("summarySource")
  const generateSummaryBtn = document.getElementById("generateSummary")
  const summaryStatusEl = document.getElementById("summaryStatus")
  const summaryPreviewEl = document.getElementById("summaryPreview")
  const summaryPreviewTextEl = document.getElementById("summaryPreviewText")
  const applySummaryBtn = document.getElementById("applySummary")

  // ── mode detection ──
  const params = new URLSearchParams(location.search)
  const embedded = params.get("embedded") === "1"
  const windowed = params.get("windowed") === "1"
  const hasTabId = params.has("tabId")
  const passedTabId = hasTabId ? Number(params.get("tabId")) : null
  const captureId = embedded && params.has("captureId") ? params.get("captureId") : null
  const hasCapture = captureId !== null
  const selectionError = "Selection is unavailable or its source page changed. Close this editor and clip again."
  const busyMessage = "An editor is already open. Finish or close it before starting another capture."
  let editorClosed = false
  let summaryPending = false
  let summaryPreview = ""
  let appliedSummary = ""
  let hasGeneratedSummary = false
  let noteRevision = 0
  let saveRevision = 0
  saveBtn.disabled = true
  saveLinkOnlyBtn.disabled = true
  if (windowed || embedded) popOutBtn.classList.add("invisible")

  // In embedded mode, route close/save-finish through postMessage to the parent
  // page so the modal can be removed.
  function closeMe() {
    editorClosed = true
    if (embedded) {
      try {
        window.parent.postMessage({ __ofSaver: true, type: "close" }, "*")
      } catch {}
    } else {
      window.close()
    }
  }

  cancelBtn.addEventListener("click", closeMe)
  closeBox.addEventListener("click", closeMe)
  saveBtn.addEventListener("click", () => send(true))
  saveLinkOnlyBtn.addEventListener("click", () => send(false))
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMe()
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      send(true)
    }
  })
  noteEl.addEventListener("input", () => {
    noteRevision++
    autoSizeTextarea(noteEl)
    updateSummaryControls()
  })

  // Embedded: titlebar acts as drag handle. Forward mousedown to parent so it
  // can move the iframe wrapper. (Mouse events inside an iframe don't reach the
  // parent — postMessage bridges the gap.)
  if (embedded) {
    // Fill the modal iframe (see popup.html .is-embedded rule); the 380px
    // width only applies to the action-popup surface.
    document.documentElement.classList.add("is-embedded")
    window.addEventListener("message", (e) => {
      if (e.source === window.parent && e.data?.__ofSaver === true && e.data.type === "capture-blocked") {
        setError(busyMessage)
      }
    })
    const titlebar = document.querySelector(".pop-titlebar")
    if (titlebar) {
      titlebar.style.cursor = "move"
      titlebar.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return
        e.preventDefault()
        try {
          window.parent.postMessage(
            { __ofSaver: true, type: "drag-start", clientX: e.clientX, clientY: e.clientY },
            "*",
          )
        } catch {}
      })
    }
    // A quick release can occur in this iframe before the parent processes
    // drag-start and disables its pointer events. Relay it so dragging ends.
    function endDrag() {
      try {
        window.parent.postMessage({ __ofSaver: true, type: "drag-end" }, "*")
      } catch {}
    }
    document.addEventListener("mouseup", endDrag, true)
    window.addEventListener("blur", endDrag)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) endDrag()
    })
  }

  let currentTab = null

  // ── progress relay from offscreen during model download ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (editorClosed || !summaryPending || msg?.target !== "popup") return
    if (msg.action === "summarizerProgress") {
      summaryStatusEl.textContent = `Downloading AI model… ${msg.percent}%`
    }
  })

  // Explicit sources never fall back to whichever page happens to be active.
  let tab
  let capture
  try {
    if (hasTabId) {
      if (!Number.isInteger(passedTabId) || passedTabId <= 0) throw new Error("Invalid source tab ID")
      tab = await chrome.tabs.get(passedTabId)
    } else {
      ;[tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
    }
    if (!tab?.url) throw new Error("Source tab is unavailable")
    if (hasCapture) {
      if (!hasTabId || !captureId) throw new Error(selectionError)
      const key = `capture:${captureId}`
      capture = (await chrome.storage.session.get(key))[key]
      const liveTab = await chrome.tabs.get(passedTabId)
      const age = Date.now() - capture?.ts
      if (
        !capture ||
        !Number.isFinite(capture.ts) ||
        age < 0 ||
        age >= 5 * 60 * 1000 ||
        capture.tabId !== passedTabId ||
        liveTab.url !== capture.url ||
        typeof capture.text !== "string" ||
        !capture.text.trim()
      ) {
        throw new Error(selectionError)
      }
      tab = { id: capture.tabId, url: capture.url, title: capture.title }
    }
  } catch (err) {
    noteLoadingEl.style.display = "none"
    setError(hasCapture ? selectionError : err.message)
    return
  }
  currentTab = tab
  try {
    const u = new URL(tab.url)
    hostEl.textContent = u.host
    pathEl.textContent = u.pathname + u.search || "/"
  } catch {
    hostEl.textContent = tab.url || "—"
    pathEl.textContent = ""
  }

  // ── title autofill ──
  titleEl.value = tab.title || ""
  autoSizeTextarea(titleEl)
  titleEl.addEventListener("input", () => autoSizeTextarea(titleEl))

  // ── theme, projects + tags from settings ──
  let settings
  try {
    settings = await chrome.storage.sync.get(["theme", "projects", "tags", "suggestMeta"])
  } catch (err) {
    noteLoadingEl.style.display = "none"
    setError(err.message)
    return
  }
  const { theme = "classic", projects = [], tags = [], suggestMeta = true } = settings
  document.body.dataset.theme = theme

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

  noteEl.value = capture ? Lib.quoteSelection(capture.text) : ""
  noteLabelEl.textContent = capture ? "Note · selection" : "Note"
  revealNoteEditor()
  autoSizeTextarea(noteEl)
  saveBtn.disabled = false
  saveLinkOnlyBtn.disabled = false
  summaryAiEl.classList.remove("hidden")
  summarySourceEl.textContent = capture ? "Selection" : "Page"
  generateSummaryBtn.title = capture ? "Summarize the original selected text" : "Summarize the source page"
  updateSummaryControls()
  if (capture && capture.text.length < Lib.SUMMARY_MIN_TEXT_LEN) {
    summaryStatusEl.textContent = `Select at least ${Lib.SUMMARY_MIN_TEXT_LEN} characters to summarize.`
  }
  generateSummaryBtn.addEventListener("click", () => runSummary())
  applySummaryBtn.addEventListener("click", () => {
    if (applySummaryBtn.disabled || !summaryPreview) return
    const suffix = summarySuffix()
    noteEl.value =
      suffix !== null
        ? summaryPreview + suffix
        : noteEl.value.trim()
          ? `${summaryPreview}\n\n${noteEl.value}`
          : summaryPreview
    noteRevision++
    appliedSummary = summaryPreview
    noteLabelEl.textContent = capture ? "Note · selection + summary" : "Note · summary"
    autoSizeTextarea(noteEl)
    summaryPreview = ""
    summaryPreviewEl.classList.add("hidden")
    summaryStatusEl.textContent = ""
    summaryStatusEl.classList.remove("error")
    updateSummaryControls()
  })
  if (capture) {
    try {
      await chrome.storage.session.remove(`capture:${captureId}`)
    } catch (err) {
      setError(`Selection loaded, but capture cleanup failed: ${err.message}`)
    }
  } else {
    chrome.runtime.sendMessage({ action: "checkAvailability" }, () => {
      if (chrome.runtime.lastError) return
    })
    runSummary({ automatic: true })
  }

  // ── AI project/tag suggestions (parallel with summary; never auto-applies) ──
  if (!suggestMeta) {
    showSuggestionStatus("AI suggestions are off in Settings.")
  } else if (!projects.length && !availableTags.length) {
    showSuggestionStatus("Add projects or tags in Settings for suggestions.")
  } else if (capture && capture.text.length < Lib.SUMMARY_MIN_TEXT_LEN) {
    showSuggestionStatus(`Select at least ${Lib.SUMMARY_MIN_TEXT_LEN} characters for suggestions.`)
  } else {
    showSuggestionStatus("Finding project/tag suggestions…", "loading")
    const message = capture
      ? { action: "suggestMetaForText", text: capture.text, title: capture.title, url: capture.url }
      : { action: "suggestMeta", tabId: tab.id }
    chrome.runtime.sendMessage(message, (resp) => {
      const error =
        chrome.runtime.lastError?.message || (!resp?.success && (resp?.error || "No response from extension"))
      if (editorClosed) return
      if (error) {
        showSuggestionStatus(`Suggestions unavailable: ${error}`, "error")
        return
      }
      if (resp.skipped === "text-too-short") {
        showSuggestionStatus(
          capture
            ? `Select at least ${Lib.SUMMARY_MIN_TEXT_LEN} characters for suggestions.`
            : "Page text is too short for suggestions.",
        )
        return
      }
      if (resp.skipped === "no-configured-names") {
        showSuggestionStatus("Add projects or tags in Settings for suggestions.")
        return
      }
      suggestStatusEl.classList.remove("loading", "error")
      suggestStatusEl.classList.add("hidden")
      renderSuggestions(resp.project, resp.tags)
      if (!suggestVal.children.length) showSuggestionStatus("No new project/tag suggestions.")
    })
  }

  // ── helpers ──
  function showSuggestionStatus(message, state) {
    suggestRow.classList.remove("hidden")
    suggestStatusEl.textContent = message
    suggestStatusEl.classList.remove("hidden", "loading", "error")
    if (state) suggestStatusEl.classList.add(state)
  }

  function runSummary({ automatic = false } = {}) {
    if (generateSummaryBtn.disabled) return
    const initialNote = noteEl.value
    const initialRevision = noteRevision
    const initialSaveRevision = saveRevision
    summaryPending = true
    summaryStatusEl.textContent = capture ? "Summarizing selection…" : "Summarizing page…"
    summaryStatusEl.classList.remove("error")
    updateSummaryControls()
    const message = capture
      ? { action: "summarizeSelection", text: capture.text }
      : { action: "summarize", tabId: currentTab.id, expectedUrl: currentTab.url }
    chrome.runtime.sendMessage(message, (resp) => {
      const error = chrome.runtime.lastError?.message || (!resp?.success && (resp?.error || "Summary unavailable"))
      summaryPending = false
      if (editorClosed) return
      const summary = error || typeof resp?.summary !== "string" ? "" : Lib.normalizeSummary(resp.summary)
      if (error || !summary) {
        summaryStatusEl.textContent = error || "No summary returned. Try again."
        summaryStatusEl.classList.add("error")
      } else {
        hasGeneratedSummary = true
        summaryStatusEl.textContent = ""
        if (
          automatic &&
          noteRevision === initialRevision &&
          noteEl.value === initialNote &&
          saveRevision === initialSaveRevision &&
          !saveBtn.disabled
        ) {
          noteEl.value = summary
          noteRevision++
          appliedSummary = summary
          noteLabelEl.textContent = "Note · summary"
          autoSizeTextarea(noteEl)
        } else {
          summaryPreview = summary
          summaryPreviewTextEl.textContent = summary
          summaryPreviewEl.classList.remove("hidden")
        }
      }
      updateSummaryControls()
    })
  }

  // Replace only an unchanged generated prefix. User edits and the quote tail
  // remain intact; editing that prefix changes the action to Add to note.
  function summarySuffix() {
    if (!appliedSummary) return null
    if (noteEl.value === appliedSummary) return ""
    return noteEl.value.startsWith(`${appliedSummary}\n\n`) ? noteEl.value.slice(appliedSummary.length) : null
  }

  function updateSummaryControls() {
    const busy = summaryPending || saveBtn.disabled || editorClosed
    generateSummaryBtn.disabled = busy || !!(capture && capture.text.length < Lib.SUMMARY_MIN_TEXT_LEN)
    generateSummaryBtn.textContent = summaryPending
      ? "Summarizing…"
      : hasGeneratedSummary
        ? "Regenerate summary"
        : "Summarize"
    applySummaryBtn.disabled = busy || !summaryPreview
    applySummaryBtn.textContent = summarySuffix() === null ? "Add to note" : "Replace summary"
  }

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
    if (saveBtn.disabled) return
    saveRevision++
    setStatus("Saving…")
    saveBtn.disabled = true
    saveLinkOnlyBtn.disabled = true
    updateSummaryControls()

    const note = includeNote ? Lib.buildNote(currentTab.url, noteEl.value) : currentTab.url

    chrome.runtime.sendMessage(
      {
        action: "addToOmnifocus",
        tabId: currentTab.id,
        customTitle: titleEl.value.trim() || currentTab.title || "",
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
          updateSummaryControls()
          return
        }
        if (resp?.success) {
          setStatus("Saved")
          setTimeout(closeMe, 600)
        } else {
          setError(resp?.error || "Failed to save")
          saveBtn.disabled = false
          saveLinkOnlyBtn.disabled = false
          updateSummaryControls()
        }
      },
    )
  }

  popOutBtn.addEventListener("click", async () => {
    if (windowed || embedded) return
    try {
      const resp = await chrome.runtime.sendMessage({ action: "openPopup", tabId: currentTab?.id })
      if (resp?.success && resp.opened) window.close()
      else setError(resp?.success ? busyMessage : resp?.error || "Pop-out failed")
    } catch (err) {
      setError(`Pop-out failed: ${err.message}`)
    }
  })
})
