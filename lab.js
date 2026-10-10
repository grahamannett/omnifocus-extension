// Dev-only page (open via Options → Summary lab as an extension page —
// chrome.* APIs don't exist over plain http). Runs input text through the
// real on-device Summarizer with user-adjustable options; each run appends
// to the table so combos stay comparable.
document.addEventListener("DOMContentLoaded", () => {
  const inputEl = document.getElementById("input")
  const runBtn = document.getElementById("run")
  const exportBtn = document.getElementById("export")
  const statusEl = document.getElementById("status")
  const availEl = document.getElementById("avail")
  const table = document.getElementById("results")
  const tbody = table.querySelector("tbody")
  const loadTabBtn = document.getElementById("loadTab")

  const fieldEls = {
    type: document.getElementById("opt-type"),
    length: document.getElementById("opt-length"),
    format: document.getElementById("opt-format"),
    preference: document.getElementById("opt-preference"),
    outputLanguage: document.getElementById("opt-output-lang"),
    expectedInputLanguages: document.getElementById("opt-input-langs"),
    sharedContext: document.getElementById("opt-shared"),
  }

  // Prefill the form with the production defaults from lib.js.
  const d = Lib.SUMMARIZER_DEFAULTS
  fieldEls.type.value = d.type
  fieldEls.length.value = d.length
  fieldEls.format.value = d.format
  fieldEls.preference.value = d.preference
  fieldEls.outputLanguage.value = d.outputLanguage
  fieldEls.expectedInputLanguages.value = d.expectedInputLanguages.join(", ")
  fieldEls.sharedContext.value = d.sharedContext

  const lastResults = []
  let runCount = 0
  let inputSource = null
  let inputRevision = 0
  let importGeneration = 0
  let activeImport = null
  let statusRevision = 0
  const loadTabLabel = loadTabBtn.textContent

  inputEl.addEventListener("input", () => {
    inputRevision++
    inputSource = null
    if (activeImport) {
      const request = activeImport
      finishImport()
      setStatusIfCurrent(request.statusRevision, "Page import canceled because input changed.")
    }
  })

  inputEl.value =
    "Honeybees communicate the location of food sources through the waggle dance, " +
    "a figure-eight movement that encodes both distance and direction relative to the sun. " +
    "Researchers have long studied how follower bees decode these movements inside the dark hive, " +
    "where they track the dancer's abdomen vibrations and wing sounds. Recent work shows that " +
    "foraging success drops sharply when returning scouts are removed, confirming the dance " +
    "carries actionable information rather than merely stimulating foraging. Understanding this " +
    "behavior helps explain how colonies efficiently exploit patchy floral resources across seasons."

  chrome.runtime.sendMessage({ action: "checkAvailability" }, (resp) => {
    const error = chrome.runtime.lastError?.message || resp?.error
    const availability = error || resp?.availability || "unknown"
    const value = document.createElement("span")
    value.className = !error && (availability === "available" || availability === "downloadable") ? "ok" : "bad"
    value.textContent = availability
    availEl.replaceChildren("Production-default model availability: ", value)
  })

  function setStatus(msg) {
    statusEl.textContent = msg
    return ++statusRevision
  }

  function setStatusIfCurrent(revision, msg) {
    if (revision === statusRevision) setStatus(msg)
  }

  function finishImport() {
    activeImport = null
    loadTabBtn.textContent = loadTabLabel
    loadTabBtn.removeAttribute("aria-busy")
  }

  function stableKey(options) {
    return JSON.stringify(Object.entries(options).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
  }

  function isDefaultCombo(options) {
    return stableKey(options) === stableKey(Lib.buildSummarizerOptions())
  }

  // Empty text fields fall back to the default (omitted = not overridden).
  function readOptions() {
    const text = (el) => el.value.trim()
    const options = {
      type: fieldEls.type.value,
      length: fieldEls.length.value,
      format: fieldEls.format.value,
    }
    if (text(fieldEls.preference)) options.preference = text(fieldEls.preference)
    if (text(fieldEls.outputLanguage)) options.outputLanguage = text(fieldEls.outputLanguage)
    const langs = text(fieldEls.expectedInputLanguages)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (langs.length) options.expectedInputLanguages = langs
    if (text(fieldEls.sharedContext)) options.sharedContext = text(fieldEls.sharedContext)
    return options
  }

  function describeOptions(options) {
    const parts = [options.type || "tldr", options.length || "short", options.format || "plain-text"]
    const shortVal = (v) => {
      const s = Array.isArray(v) ? v.join("+") : String(v)
      return s.length > 48 ? s.slice(0, 47) + "…" : s
    }
    const extra = Object.entries(options)
      .filter(([k]) => !["type", "length", "format"].includes(k))
      .map(([k, v]) => `${k}=${shortVal(v)}`)
    return parts.join(" / ") + (extra.length ? ` (${extra.join(", ")})` : "")
  }

  function renderRow(entry) {
    const tr = document.createElement("tr")
    const isDefault = isDefaultCombo(entry.options)
    const failed = entry.outputChars === null
    if (isDefault) tr.classList.add("is-default")
    const label = `#${entry.n} ${isDefault ? "★ " : ""}${describeOptions(entry.options)}`
    const optsTd = document.createElement("td")
    optsTd.className = "opts"
    optsTd.textContent = label
    const started = document.createElement("div")
    started.textContent = entry.startedAt
    optsTd.appendChild(started)
    const inputTd = document.createElement("td")
    inputTd.className = "input"
    const lengths = document.createElement("div")
    lengths.textContent = `${entry.inputText.length} original / ${entry.effectiveText.length} effective`
    inputTd.appendChild(lengths)
    if (entry.inputText.length > entry.effectiveText.length) {
      const clipped = document.createElement("div")
      clipped.textContent = `Prepared input limited to ${Lib.SUMMARY_MAX_TEXT_LEN.toLocaleString("en-US")} characters.`
      inputTd.appendChild(clipped)
    }
    const details = document.createElement("details")
    const detailLabel = document.createElement("summary")
    detailLabel.textContent = "Exact effective input"
    details.appendChild(detailLabel)
    if (entry.source) {
      const source = document.createElement("div")
      source.className = "source"
      source.textContent = `Source: ${entry.source.title}\n${entry.source.url}`
      details.appendChild(source)
    }
    const effectiveInput = document.createElement("pre")
    effectiveInput.textContent = entry.effectiveText
    details.appendChild(effectiveInput)
    inputTd.appendChild(details)
    const msTd = document.createElement("td")
    msTd.className = "num"
    msTd.textContent = entry.ms != null ? String(entry.ms) : "—"
    const charsTd = document.createElement("td")
    charsTd.className = "num"
    charsTd.textContent = failed ? "—" : String(entry.outputChars)
    const sumTd = document.createElement("td")
    sumTd.className = "sum"
    if (failed) {
      sumTd.className = "err"
      sumTd.textContent = entry.error
    } else {
      sumTd.textContent = entry.summary
    }
    const copyTd = document.createElement("td")
    if (!failed) {
      const btn = document.createElement("button")
      btn.type = "button"
      btn.textContent = "Copy"
      btn.addEventListener("click", async () => {
        await navigator.clipboard.writeText(entry.summary)
        btn.textContent = "Copied"
        setTimeout(() => (btn.textContent = "Copy"), 1200)
      })
      copyTd.appendChild(btn)
    }
    tr.append(optsTd, inputTd, msTd, charsTd, sumTd, copyTd)
    tbody.appendChild(tr)
  }

  function runOne(text, options) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "summarizeWithOptions", text, options }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
        } else if (resp?.success) {
          resolve(resp.summary)
        } else {
          reject(new Error(resp?.error || "failed"))
        }
      })
    })
  }

  loadTabBtn.addEventListener("click", () => {
    const request = {
      generation: ++importGeneration,
      inputRevision,
      statusRevision: setStatus("Loading recent page text…"),
    }
    activeImport = request
    loadTabBtn.textContent = "Loading…"
    loadTabBtn.setAttribute("aria-busy", "true")
    chrome.runtime.sendMessage({ action: "labGetTabText" }, (resp) => {
      // An edit or a newer request owns the input now. Stale callbacks also
      // leave the newer request's loading indicator and status untouched.
      if (
        activeImport !== request ||
        request.generation !== importGeneration ||
        request.inputRevision !== inputRevision
      )
        return
      finishImport()
      if (chrome.runtime.lastError) {
        setStatusIfCurrent(request.statusRevision, chrome.runtime.lastError.message)
        return
      }
      if (!resp?.success) {
        setStatusIfCurrent(request.statusRevision, resp?.error || "Could not read tab")
        return
      }
      inputEl.value = resp.text || ""
      inputSource = { title: resp.title || "", url: resp.url || "" }
      setStatusIfCurrent(
        request.statusRevision,
        `${(resp.text || "").length} chars from ${resp.title || resp.url || "tab"}`,
      )
    })
  })

  runBtn.addEventListener("click", async () => {
    const inputText = inputEl.value
    let effectiveText
    try {
      effectiveText = Lib.prepareText(inputText)
    } catch (err) {
      setStatus(`Need at least ${Lib.SUMMARY_MIN_TEXT_LEN} chars of input`)
      return
    }
    const entry = {
      n: ++runCount,
      startedAt: new Date().toISOString(),
      inputText,
      effectiveText,
      options: Lib.buildSummarizerOptions(readOptions()),
      source: inputSource ? { ...inputSource } : null,
      outputChars: null,
    }
    runBtn.disabled = true
    exportBtn.disabled = true
    table.hidden = false
    const runStatusRevision = setStatus(`Running ${describeOptions(entry.options)}…`)
    const t0 = performance.now()
    try {
      entry.summary = Lib.normalizeSummary(await runOne(entry.effectiveText, entry.options))
      entry.outputChars = entry.summary.length
    } catch (err) {
      entry.error = err.message || String(err)
    } finally {
      entry.ms = Math.round(performance.now() - t0)
      runBtn.disabled = false
      exportBtn.disabled = false
    }
    lastResults.push(entry)
    renderRow(entry)
    setStatusIfCurrent(
      runStatusRevision,
      entry.outputChars === null ? `Run #${entry.n} failed: ${entry.error}` : `Run #${entry.n} done`,
    )
  })

  exportBtn.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), results: lastResults }, null, 2)], {
      type: "application/json",
    })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "summary-lab-results.json"
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  })
})
