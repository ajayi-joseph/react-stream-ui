import type {
  RawMessageStreamEvent,
  StopReason,
} from "@anthropic-ai/sdk/resources/messages";
import type { StreamChunk } from "../../src/index.js";

// Convert an Anthropic Messages stream into the StreamChunk shape that
// react-stream-ui's hooks consume. Works with the SDK's MessageStream as well
// as any AsyncIterable<RawMessageStreamEvent> (e.g. a parsed SSE reader from
// your own backend).
export async function* fromAnthropicStream(
  stream: AsyncIterable<RawMessageStreamEvent>,
): AsyncGenerator<StreamChunk> {
  // Anthropic addresses content blocks by `index`. We only care about tool_use
  // blocks here — the index → id map lets `content_block_stop` close the right
  // tool call. Stop reason arrives on `message_delta` and is emitted at
  // `message_stop`.
  const toolIds = new Map<number, string>();
  let stopReason: StopReason | null = null;

  for await (const event of stream) {
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block.type === "tool_use") {
          toolIds.set(event.index, block.id);
          yield { type: "tool-call-start", id: block.id, name: block.name };
        }
        break;
      }
      case "content_block_delta": {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text-delta", text: delta.text };
        } else if (delta.type === "thinking_delta") {
          yield { type: "thinking-delta", text: delta.thinking };
        } else if (delta.type === "input_json_delta") {
          const id = toolIds.get(event.index);
          if (id !== undefined) {
            yield { type: "tool-call-delta", id, argsDelta: delta.partial_json };
          }
        }
        // signature_delta and citations_delta have no equivalent in our shape.
        break;
      }
      case "content_block_stop": {
        const id = toolIds.get(event.index);
        if (id !== undefined) {
          toolIds.delete(event.index);
          yield { type: "tool-call-end", id };
        }
        break;
      }
      case "message_delta":
        stopReason = event.delta.stop_reason;
        break;
      case "message_stop":
        yield mapStopReason(stopReason);
        break;
      // message_start carries metadata only.
    }
  }
}

function mapStopReason(reason: StopReason | null): StreamChunk {
  if (reason === "max_tokens") return { type: "finish", reason: "length" };
  if (reason === "tool_use") return { type: "finish", reason: "tool_use" };
  // end_turn, stop_sequence, pause_turn, refusal, null all fold into "stop".
  return { type: "finish", reason: "stop" };
}
