import type { StreamChunk, StreamSource } from "../types.js";

export function makeStream(chunks: StreamChunk[]): StreamSource {
  return (async function* () {
    for (const c of chunks) yield c;
  })();
}

export type ControlledStream = {
  stream: StreamSource;
  push: (chunk: StreamChunk) => void;
  close: () => void;
  returnCalled: () => boolean;
};

export function makeControlledStream(): ControlledStream {
  const queue: StreamChunk[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let returned = false;

  const wakeup = () => {
    const w = wake;
    wake = undefined;
    w?.();
  };

  const stream: StreamSource = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<StreamChunk>> {
          while (true) {
            if (returned) return { done: true, value: undefined };
            if (queue.length > 0) return { done: false, value: queue.shift()! };
            if (closed) return { done: true, value: undefined };
            await new Promise<void>((r) => {
              wake = r;
            });
          }
        },
        async return(): Promise<IteratorResult<StreamChunk>> {
          returned = true;
          wakeup();
          return { done: true, value: undefined };
        },
      };
    },
  };

  return {
    stream,
    push: (c) => {
      queue.push(c);
      wakeup();
    },
    close: () => {
      closed = true;
      wakeup();
    },
    returnCalled: () => returned,
  };
}
