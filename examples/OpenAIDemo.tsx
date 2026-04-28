// The component takes a stream factory rather than an OpenAI client because
// instantiating the client in the browser would expose your API key. Wire the
// factory to a server route in production; pass the SDK call directly only in
// Node / Server Components.

import { useMemo } from "react";
import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import {
  useStreamingMessage,
  useToolCall,
  type Message,
  type StreamSource,
} from "../src/index.js";
import { fromOpenAIStream } from "./adapters/openai.js";

type ChunkStreamFactory = () =>
  | AsyncIterable<ChatCompletionChunk>
  | Promise<AsyncIterable<ChatCompletionChunk>>;

export function OpenAIDemo({ chunkStream }: { chunkStream: ChunkStreamFactory }) {
  const stream = useMemo<StreamSource>(() => {
    return (async function* () {
      const inner = await chunkStream();
      yield* fromOpenAIStream(inner);
    })();
  }, [chunkStream]);

  const { message, isStreaming, error } = useStreamingMessage(stream);

  if (error) return <div role="alert">Error: {error.message}</div>;

  return (
    <div>
      {message.content.map((block, i) => {
        if (block.type === "text") return <p key={i}>{block.text}</p>;
        if (block.type === "thinking") return <pre key={i}>{block.text}</pre>;
        if (block.type === "tool-call") {
          return <ToolCallView key={i} message={message} id={block.id} />;
        }
        return null;
      })}
      {isStreaming && <span aria-label="streaming">▍</span>}
    </div>
  );
}

function ToolCallView({ message, id }: { message: Message; id: string }) {
  const call = useToolCall(message, id);
  if (!call) return null;
  return (
    <div>
      <strong>{call.name}</strong>
      <pre>{JSON.stringify(call.args, null, 2)}</pre>
      {call.isPartial && <em>(streaming…)</em>}
    </div>
  );
}
