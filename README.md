# react-stream-ui

Headless React primitives for streaming LLM responses. Provider-agnostic, UI-agnostic, with first-class support for **partial JSON streaming** so tool-call arguments and structured outputs render as they arrive.

## Why

Most React AI libraries either ship opinionated UI (chat bubbles, prebuilt panels) or couple tightly to one provider. `react-stream-ui` is just hooks and types: feed it a stream of chunks, get back React state you can render however you want.

The wedge: **partial JSON parsing**. While a tool call's arguments are still streaming in, you can already read the partially-parsed object — type-safe, with `isPartial` flags so you know what's settled.

## Install

```bash
npm install react-stream-ui
```

## Quick start

```tsx
import { useStreamingMessage, useToolCall } from "react-stream-ui";

function Assistant({ stream }) {
  const { message, isStreaming } = useStreamingMessage(stream);

  return (
    <div>
      {message.content.map((block, i) => {
        if (block.type === "text") return <p key={i}>{block.text}</p>;
        if (block.type === "thinking") return <Thought key={i} text={block.text} />;
        if (block.type === "tool-call") return <ToolCall key={i} call={block} />;
        return null;
      })}
      {isStreaming && <Cursor />}
    </div>
  );
}
```

## Streaming structured output

```tsx
const { value, isPartial } = useStructuredOutput<{ items: string[] }>(stream);
// value.items renders incrementally as the model emits JSON
```

## API

- `useStreamingMessage(stream, signal?)` — accumulate chunks into an `AssistantMessage` with text, thinking, and tool-call blocks
- `useToolCall(message, id)` — selector for a single tool call's state
- `useStructuredOutput<T>(stream, signal?)` — typed partial JSON value that fills in as it streams
- `parsePartialJSON(input)` — the underlying parser, exported for direct use

## Knowing why a stream ended

Both stream hooks return `finishReason: "stop" | "length" | "tool_use" | undefined`. It stays undefined while streaming and is set when the stream emits its terminal `finish` chunk, so you can distinguish a clean completion from a token-limit truncation or a tool-call handoff. If the stream errored, `error` is set and `finishReason` stays undefined — the two are mutually exclusive.

```tsx
const { message, isStreaming, finishReason, error } = useStreamingMessage(stream);

if (error) return <Error message={error.message} />;
if (!isStreaming && finishReason === "length") return <Truncated message={message} />;
if (!isStreaming && finishReason === "tool_use") return <RunTool message={message} />;
```

## Cancellation

Pass an `AbortSignal` to stop a stream from outside the component. Unmounting also cancels — both paths call `iter.return()` on the iterator so producers get a chance to release resources.

```tsx
const controller = useMemo(() => new AbortController(), []);
const { message } = useStreamingMessage(stream, controller.signal);
// later: controller.abort();
```

## Providers

`react-stream-ui` doesn't talk to any LLM directly. You bring the stream — official adapters for Anthropic, OpenAI, etc. are planned as separate packages so the core stays tiny and dependency-free.

Reference adapters for [OpenAI](./examples/adapters/openai.ts) and [Anthropic](./examples/adapters/anthropic.ts) live in `examples/adapters/` — copy them into your project or use them as templates for other providers. They map each provider's native chunk type to the `StreamChunk` shape the hooks consume.

## License

MIT
