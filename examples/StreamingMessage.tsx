import { useMemo } from "react";
import {
  useStreamingMessage,
  useToolCall,
  type StreamChunk,
  type StreamSource,
  type ToolCallBlock,
} from "../src/index.js";

// Demo stream that simulates a model writing some text and then calling a tool
// with arguments that arrive in pieces. Wire your real provider here instead.
async function* demoStream(): AsyncGenerator<StreamChunk> {
  yield { type: "text-delta", text: "Looking up the weather" };
  yield { type: "text-delta", text: " for you...\n" };

  const id = "call_1";
  yield { type: "tool-call-start", id, name: "get_weather" };
  for (const piece of ['{"city":"', "San ", 'Francisco","units":"', 'celsius"}']) {
    yield { type: "tool-call-delta", id, argsDelta: piece };
  }
  yield { type: "tool-call-end", id };
  yield { type: "finish", reason: "tool_use" };
}

export function Demo() {
  const stream = useMemo<StreamSource>(() => demoStream(), []);
  const { message, isStreaming } = useStreamingMessage(stream);

  return (
    <div>
      {message.content.map((block, i) => {
        if (block.type === "text") return <p key={i}>{block.text}</p>;
        if (block.type === "thinking") return <pre key={i}>{block.text}</pre>;
        if (block.type === "tool-call") return <ToolCallView key={i} message={message} id={block.id} />;
        return null;
      })}
      {isStreaming && <span aria-label="streaming">▍</span>}
    </div>
  );
}

function ToolCallView({ message, id }: { message: ReturnType<typeof useStreamingMessage>["message"]; id: string }) {
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

export type { ToolCallBlock };
