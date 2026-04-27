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

- `useStreamingMessage(stream)` — accumulate chunks into a `Message` with text, thinking, and tool-call blocks
- `useToolCall(message, id)` — selector for a single tool call's state
- `useStructuredOutput<T>(stream)` — typed partial JSON value that fills in as it streams
- `parsePartialJSON(input)` — the underlying parser, exported for direct use

## Providers

`react-stream-ui` doesn't talk to any LLM directly. You bring the stream — adapters for Anthropic, OpenAI, etc. are planned as separate packages so the core stays tiny and dependency-free.

## License

MIT
