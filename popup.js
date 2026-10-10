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
  const hasTabId = params.has("tabId")
  const passedTabId = hasTabId ? Number(params.get("tabId")) : null
  const captureId = embedded && params.has("captureId") ? params.get("captureId") : null
  const hasCapture = captureId !== null
  const selectionError = "Selection is unavailable or its source page changed. Close this editor and clip again."
  const busyMessage = "An editor is already open. Finish or close it before starting another capture."
  saveBtn.disabled = true
  saveLinkOnlyBtn.disabled = true
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
  noteEl.addEventListener("input", () => autoSizeTextarea(noteEl))

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

  let currentTab = null

  // ── progress relay from offscreen during model download ──
  chrome.runtime.onMessage.addListener((msg) => {
    if (hasCapture || msg?.target !== "popup") return
    if (msg.action === "summarizerProgress") {
      noteLabelEl.textContent = `Note · model dl ${msg.percent}%`
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

  if (capture) {
    noteEl.value = Lib.quoteSelection(capture.text)
    noteLabelEl.textContent = "Note · selection"
    revealNoteEditor()
    autoSizeTextarea(noteEl)
    saveBtn.disabled = false
    saveLinkOnlyBtn.disabled = false
    try {
      await chrome.storage.session.remove(`capture:${captureId}`)
    } catch (err) {
      setError(`Selection loaded, but capture cleanup failed: ${err.message}`)
    }
  } else {
    saveBtn.disabled = false
    saveLinkOnlyBtn.disabled = false
    chrome.runtime.sendMessage({ action: "checkAvailability" }, () => {
      if (chrome.runtime.lastError) return
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
  }

  // ── AI project/tag suggestions (parallel with summary; never auto-applies) ──
  if (!hasCapture && suggestMeta && (projects.length || availableTags.length)) {
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
    if (saveBtn.disabled) return
    setStatus("Saving…")
    saveBtn.disabled = true
    saveLinkOnlyBtn.disabled = true

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
