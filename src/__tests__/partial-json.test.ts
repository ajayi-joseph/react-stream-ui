import { describe, expect, it } from "vitest";
import { parsePartialJSON } from "../parsers/partial-json.js";

describe("parsePartialJSON — complete inputs", () => {
  it("parses a complete object", () => {
    const r = parsePartialJSON('{"a":1,"b":"two"}');
    expect(r.value).toEqual({ a: 1, b: "two" });
    expect(r.isPartial).toBe(false);
  });

  it("parses a complete array", () => {
    const r = parsePartialJSON("[1,2,3]");
    expect(r.value).toEqual([1, 2, 3]);
    expect(r.isPartial).toBe(false);
  });

  it("returns undefined for empty input", () => {
    const r = parsePartialJSON("");
    expect(r.value).toBeUndefined();
    expect(r.isPartial).toBe(true);
  });
});

describe("parsePartialJSON — partial inputs", () => {
  it("closes an unterminated string value", () => {
    const r = parsePartialJSON('{"name":"Jo');
    expect(r.value).toEqual({ name: "Jo" });
    expect(r.isPartial).toBe(true);
  });

  it("closes nested containers", () => {
    const r = parsePartialJSON('{"users":[{"id":1');
    expect(r.value).toEqual({ users: [{ id: 1 }] });
    expect(r.isPartial).toBe(true);
  });

  it("drops a trailing comma", () => {
    const r = parsePartialJSON('{"a":1,');
    expect(r.value).toEqual({ a: 1 });
    expect(r.isPartial).toBe(true);
  });

  it("fills in null for a dangling colon", () => {
    const r = parsePartialJSON('{"a":');
    expect(r.value).toEqual({ a: null });
    expect(r.isPartial).toBe(true);
  });

  it("drops an orphan partial key", () => {
    const r = parsePartialJSON('{"a":1,"b');
    expect(r.value).toEqual({ a: 1 });
    expect(r.isPartial).toBe(true);
  });

  it("drops an orphan partial key when it's the only one", () => {
    const r = parsePartialJSON('{"b');
    expect(r.value).toEqual({});
    expect(r.isPartial).toBe(true);
  });

  it("drops an orphan complete key with no colon yet", () => {
    const r = parsePartialJSON('{"a":1,"b"');
    expect(r.value).toEqual({ a: 1 });
    expect(r.isPartial).toBe(true);
  });

  it("drops a partial literal value", () => {
    const r = parsePartialJSON('{"flag":tru');
    expect(r.value).toEqual({});
    expect(r.isPartial).toBe(true);
  });

  it("handles a partial array of strings", () => {
    const r = parsePartialJSON('["one","tw');
    expect(r.value).toEqual(["one", "tw"]);
    expect(r.isPartial).toBe(true);
  });

  it("respects escaped quotes inside strings", () => {
    const r = parsePartialJSON('{"q":"she said \\"hi');
    expect(r.value).toEqual({ q: 'she said "hi' });
    expect(r.isPartial).toBe(true);
  });

  it("drops a trailing backslash that would escape the closing quote", () => {
    const r = parsePartialJSON('{"q":"hi\\');
    expect(r.value).toEqual({ q: "hi" });
    expect(r.isPartial).toBe(true);
  });

  it("streams progressively without losing earlier fields", () => {
    const stages = [
      "{",
      '{"',
      '{"items":',
      '{"items":[',
      '{"items":["a"',
      '{"items":["a","b"',
      '{"items":["a","b"],"count":',
      '{"items":["a","b"],"count":2}',
    ];
    const results = stages.map((s) => parsePartialJSON(s));
    expect(results[results.length - 1]!.value).toEqual({ items: ["a", "b"], count: 2 });
    expect(results[results.length - 1]!.isPartial).toBe(false);
    // every intermediate stage must yield a defined value (possibly empty)
    for (const r of results.slice(1)) {
      expect(r.value).toBeDefined();
    }
  });
});

describe("parsePartialJSON — scientific notation", () => {
  it("keeps a complete positive exponent", () => {
    const r = parsePartialJSON('{"a":1.5e3');
    expect(r.value).toEqual({ a: 1500 });
    expect(r.isPartial).toBe(true);
  });

  it("keeps a complete signed exponent", () => {
    const r = parsePartialJSON('{"a":1.5e-3');
    expect(r.value).toEqual({ a: 0.0015 });
    expect(r.isPartial).toBe(true);
  });

  it("keeps a complete exponent with explicit plus sign", () => {
    const r = parsePartialJSON('{"a":1e+5');
    expect(r.value).toEqual({ a: 100000 });
    expect(r.isPartial).toBe(true);
  });

  it("drops a partial exponent with no digits yet", () => {
    const r = parsePartialJSON('{"a":1.5e');
    expect(r.value).toEqual({});
    expect(r.isPartial).toBe(true);
  });

  it("drops a partial signed exponent with no digits yet", () => {
    const r = parsePartialJSON('{"a":1.5e-');
    expect(r.value).toEqual({});
    expect(r.isPartial).toBe(true);
  });
});

describe("parsePartialJSON — unicode escapes", () => {
  it("preserves earlier fields when the string ends mid-escape with no hex digits", () => {
    const r = parsePartialJSON('{"a":"hello \\u');
    expect(r.value).toEqual({ a: "hello " });
    expect(r.isPartial).toBe(true);
  });

  it("preserves earlier fields when the string ends mid-escape with some hex digits", () => {
    const r = parsePartialJSON('{"a":"hi \\u00A');
    expect(r.value).toEqual({ a: "hi " });
    expect(r.isPartial).toBe(true);
  });

  it("keeps a complete \\u escape at end of an unterminated string", () => {
    const r = parsePartialJSON('{"a":"\\u00ff');
    expect(r.value).toEqual({ a: "ÿ" });
    expect(r.isPartial).toBe(true);
  });

  it("treats `\\\\u00` as a literal backslash + u00 — not an incomplete escape", () => {
    const r = parsePartialJSON('{"a":"x\\\\u00');
    expect(r.value).toEqual({ a: "x\\u00" });
    expect(r.isPartial).toBe(true);
  });
});
