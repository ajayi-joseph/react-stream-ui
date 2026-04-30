import { describe, expect, it } from "vitest";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import { fromOpenAIStream } from "../../../examples/adapters/openai.js";
import type { StreamChunk } from "../../index.js";

async function* fromArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

type Choice = ChatCompletionChunk["choices"][number];

function chunk(choice: Partial<Choice> = {}): ChatCompletionChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: null,
        ...choice,
      } as Choice,
    ],
  };
}

function emptyChoicesChunk(): ChatCompletionChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 0,
    model: "gpt-4o-mini",
    choices: [],
  };
}

describe("fromOpenAIStream — text", () => {
  it("yields a text-delta per content delta and a final finish", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({ delta: { content: "hello" } }),
          chunk({ delta: { content: " world" } }),
          chunk({ delta: {}, finish_reason: "stop" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "text-delta", text: "hello" },
      { type: "text-delta", text: " world" },
      { type: "finish", reason: "stop" },
    ]);
  });

  it("ignores empty content deltas", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({ delta: { content: "" } }),
          chunk({ delta: { content: "x" } }),
          chunk({ delta: {}, finish_reason: "stop" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "text-delta", text: "x" },
      { type: "finish", reason: "stop" },
    ]);
  });
});

describe("fromOpenAIStream — tool calls", () => {
  it("emits start, deltas, end, and a tool_use finish", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({
            delta: {
              tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup" } }],
            },
          }),
          chunk({
            delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":' } }] },
          }),
          chunk({
            delta: { tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }] },
          }),
          chunk({ delta: {}, finish_reason: "tool_calls" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "tool-call-start", id: "call_1", name: "lookup" },
      { type: "tool-call-delta", id: "call_1", argsDelta: '{"q":' },
      { type: "tool-call-delta", id: "call_1", argsDelta: '"hi"}' },
      { type: "tool-call-end", id: "call_1" },
      { type: "finish", reason: "tool_use" },
    ]);
  });

  it("falls back to a synthetic id when the first chunk omits id", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({ delta: { tool_calls: [{ index: 2, function: { name: "x" } }] } }),
          chunk({ delta: { tool_calls: [{ index: 2, function: { arguments: "{}" } }] } }),
          chunk({ delta: {}, finish_reason: "tool_calls" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "tool-call-start", id: "tool_2", name: "x" },
      { type: "tool-call-delta", id: "tool_2", argsDelta: "{}" },
      { type: "tool-call-end", id: "tool_2" },
      { type: "finish", reason: "tool_use" },
    ]);
  });

  it("interleaves multiple tool calls keyed by index and closes both", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({
            delta: {
              tool_calls: [
                { index: 0, id: "a", function: { name: "f" } },
                { index: 1, id: "b", function: { name: "g" } },
              ],
            },
          }),
          chunk({
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: "{" } },
                { index: 1, function: { arguments: "[" } },
              ],
            },
          }),
          chunk({ delta: {}, finish_reason: "tool_calls" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "tool-call-start", id: "a", name: "f" },
      { type: "tool-call-start", id: "b", name: "g" },
      { type: "tool-call-delta", id: "a", argsDelta: "{" },
      { type: "tool-call-delta", id: "b", argsDelta: "[" },
      { type: "tool-call-end", id: "a" },
      { type: "tool-call-end", id: "b" },
      { type: "finish", reason: "tool_use" },
    ]);
  });

  it("defaults the tool name to empty string when not provided", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({ delta: { tool_calls: [{ index: 0, id: "x" }] } }),
          chunk({ delta: {}, finish_reason: "tool_calls" }),
        ]),
      ),
    );
    expect(out[0]).toEqual({ type: "tool-call-start", id: "x", name: "" });
  });
});

describe("fromOpenAIStream — finish reasons", () => {
  it("maps length to length", async () => {
    const out = await collect(
      fromOpenAIStream(fromArray([chunk({ delta: {}, finish_reason: "length" })])),
    );
    expect(out).toEqual([{ type: "finish", reason: "length" }]);
  });

  it("maps content_filter to stop", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([chunk({ delta: {}, finish_reason: "content_filter" })]),
      ),
    );
    expect(out).toEqual([{ type: "finish", reason: "stop" }]);
  });

  it("maps deprecated function_call to stop", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([chunk({ delta: {}, finish_reason: "function_call" })]),
      ),
    );
    expect(out).toEqual([{ type: "finish", reason: "stop" }]);
  });
});

describe("fromOpenAIStream — edge cases", () => {
  it("skips chunks with no choices (e.g. final usage chunk)", async () => {
    const out = await collect(
      fromOpenAIStream(
        fromArray([
          chunk({ delta: { content: "hi" } }),
          emptyChoicesChunk(),
          chunk({ delta: {}, finish_reason: "stop" }),
        ]),
      ),
    );
    expect(out).toEqual([
      { type: "text-delta", text: "hi" },
      { type: "finish", reason: "stop" },
    ]);
  });
});
