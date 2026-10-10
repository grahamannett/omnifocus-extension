const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const Lib = require("../lib.js")

describe("prepareText", () => {
  it("rejects empty and short input", () => {
    assert.throws(() => Lib.prepareText(""), /text too short/)
    assert.throws(() => Lib.prepareText(null), /text too short/)
    assert.throws(() => Lib.prepareText("x".repeat(49)), /text too short/)
  })

  it("passes through text at the minimum length", () => {
    const text = "x".repeat(50)
    assert.equal(Lib.prepareText(text), text)
  })

  it("truncates text over the maximum length", () => {
    const prefix = "ab".repeat(4000)
    assert.equal(Lib.prepareText(prefix + "!"), prefix)
    assert.equal(Lib.prepareText(prefix), prefix)
  })
})

describe("buildSummarizerOptions", () => {
  it("merges overrides without mutating defaults", () => {
    const opts = Lib.buildSummarizerOptions({ type: "key-points", length: "long" })
    assert.equal(opts.type, "key-points")
    assert.equal(opts.length, "long")
    assert.equal(opts.format, "plain-text")
    opts.type = "mutated"
    assert.equal(Lib.buildSummarizerOptions().type, "tldr")
  })

  it("isolates language arrays across defaults, overrides and returned options", () => {
    const previous = Lib.buildSummarizerOptions()
    const defaults = previous.expectedInputLanguages.slice()
    const input = ["fr"]
    const context = ["de"]
    const opts = Lib.buildSummarizerOptions({ expectedInputLanguages: input, expectedContextLanguages: context })
    input.push("es")
    context.push("it")
    assert.deepEqual(opts.expectedInputLanguages, ["fr"])
    assert.deepEqual(opts.expectedContextLanguages, ["de"])
    opts.expectedInputLanguages.push("ja")
    previous.expectedInputLanguages.push("ko")
    assert.deepEqual(Lib.buildSummarizerOptions().expectedInputLanguages, defaults)
    assert.throws(() => Lib.SUMMARIZER_DEFAULTS.expectedInputLanguages.push("xx"), TypeError)
    assert.equal(Reflect.set(Lib.SUMMARIZER_DEFAULTS, "type", "changed"), false)
  })
})

describe("normalizeSummary", () => {
  it("trims model output and tolerates empties", () => {
    assert.equal(Lib.normalizeSummary("  hello  "), "hello")
    assert.equal(Lib.normalizeSummary(""), "")
    assert.equal(Lib.normalizeSummary(null), "")
    assert.equal(Lib.normalizeSummary(undefined), "")
  })
})

describe("buildOmnifocusUrl", () => {
  it("encodes spaces as %20 (OmniFocus treats + as literal)", () => {
    const url = Lib.buildOmnifocusUrl({ name: "a b", note: "c d" })
    assert.ok(url.startsWith("omnifocus:///add?"))
    assert.ok(url.includes("name=a%20b"))
    assert.ok(url.includes("note=c%20d"))
    assert.ok(!url.includes("+"))
  })

  it("encodes + and appends project/tags/flag/due", () => {
    const url = Lib.buildOmnifocusUrl({
      name: "a+b",
      note: "n",
      project: "Work",
      tags: ["mac", "ios"],
      flag: true,
      due: "2026-09-04",
    })
    assert.ok(url.includes("name=a%2Bb"))
    assert.ok(url.includes("project=Work"))
    assert.ok(url.includes("tags=mac%2Cios"))
    assert.ok(url.includes("flag=true"))
    assert.ok(url.includes("due=2026-09-04"))
  })

  it("omits unset optionals", () => {
    const url = Lib.buildOmnifocusUrl({ name: "t", note: "u" })
    assert.equal(url, "omnifocus:///add?name=t&note=u")
  })
})

describe("selection note transport", () => {
  const url = "https://ex.com/page"
  const decodedNote = (body) =>
    new URL(
      Lib.buildOmnifocusUrl({
        name: "Selection",
        note: Lib.buildNote(url, body),
      }),
    ).searchParams.get("note")

  it("preserves the full selection including whitespace and supplementary Unicode", () => {
    const text = "  " + "a".repeat(1997) + "\u{1F600}\n" + "b".repeat(4000) + "  "
    assert.equal(decodedNote(Lib.quoteSelection(text)), url + "\n\n“" + text + "”")
  })

  it("does not remove a source URL that occurs inside the selection", () => {
    const text = `Read ${url} here`
    assert.equal(decodedNote(Lib.quoteSelection(text)), `${url}\n\n“${text}”`)
  })

  it("composes empty notes and Link only as URL only", () => {
    assert.equal(decodedNote(""), url)
    assert.equal(decodedNote(" \n "), url)
    assert.equal(Lib.quoteSelection(" \n "), "")
    assert.equal(Lib.quoteSelection(null), "")
    assert.equal(Lib.buildNote("", "  note  "), "note")
  })
})
