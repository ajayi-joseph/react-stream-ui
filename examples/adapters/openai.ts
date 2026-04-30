import type { ChatCompletionChunk } from "openai/resources/chat/completions";
import type { StreamChunk } from "../../src/index.js";

// Convert an OpenAI Chat Completions stream into the StreamChunk shape that
// react-partial-stream's hooks consume. Works with anything async-iterable that
// yields ChatCompletionChunk — the SDK's own `Stream` and a hand-parsed SSE
// reader both qualify.
export async function* fromOpenAIStream(
  stream: AsyncIterable<ChatCompletionChunk>,
): AsyncGenerator<StreamChunk> {
  // OpenAI streams tool calls keyed by `index`, with id+name in the first
  // chunk and `arguments` deltas in subsequent ones. Track the assigned id
  // per index so we can emit our own start/delta/end events.
  const toolIds = new Map<number, string>();

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const { delta, finish_reason } = choice;

    if (delta?.content) {
      yield { type: "text-delta", text: delta.content };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        let id = toolIds.get(tc.index);
        if (id === undefined) {
          id = tc.id ?? `tool_${tc.index}`;
          toolIds.set(tc.index, id);
          yield { type: "tool-call-start", id, name: tc.function?.name ?? "" };
        }
        const argsDelta = tc.function?.arguments;
        if (argsDelta) {
          yield { type: "tool-call-delta", id, argsDelta };
        }
      }
    }

    if (finish_reason) {
      for (const id of toolIds.values()) {
        yield { type: "tool-call-end", id };
      }
      toolIds.clear();
      yield mapFinishReason(finish_reason);
    }
  }
}

function mapFinishReason(reason: NonNullable<ChatCompletionChunk.Choice["finish_reason"]>): StreamChunk {
  if (reason === "tool_calls") return { type: "finish", reason: "tool_use" };
  if (reason === "length") return { type: "finish", reason: "length" };
  // "content_filter" and the deprecated "function_call" both fold into "stop".
  return { type: "finish", reason: "stop" };
}
