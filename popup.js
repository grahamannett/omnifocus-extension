document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status")
  const saveBtn = document.getElementById("saveToOmniFocus")
  const saveNoSummaryBtn = document.getElementById("saveToOmniFocusNoSummary")

  let downloading = false

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.target !== "popup") return
    if (msg.action === "summarizerProgress" && downloading) {
      status.textContent = `Downloading AI model… ${msg.percent}%`
    }
  })

  chrome.runtime.sendMessage({ action: "checkAvailability" }, (resp) => {
    if (chrome.runtime.lastError || !resp?.success) return
    if (resp.availability === "unavailable") {
      saveBtn.disabled = true
      saveBtn.title = "AI summarizer not available on this device"
    }
  })

  function send(llmEnabled, busyLabel) {
    status.textContent = busyLabel
    downloading = llmEnabled
    saveBtn.disabled = true
    saveNoSummaryBtn.disabled = true
    chrome.runtime.sendMessage({ action: "addToOmnifocus", llmEnabled }, (resp) => {
      downloading = false
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message
        saveBtn.disabled = false
        saveNoSummaryBtn.disabled = false
        return
      }
      if (resp?.success) {
        status.textContent = resp.summarySkipped
          ? `Added to OmniFocus (no summary: ${resp.reason})`
          : "Added to OmniFocus"
        setTimeout(() => window.close(), resp.summarySkipped ? 1800 : 800)
      } else {
        status.textContent = resp?.error || "Failed to add to OmniFocus"
        saveBtn.disabled = false
        saveNoSummaryBtn.disabled = false
      }
    })
  }

  saveBtn.addEventListener("click", () => send(true, "Adding with summary…"))
  saveNoSummaryBtn.addEventListener("click", () => send(false, "Adding…"))
})
