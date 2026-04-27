type Frame = { type: "obj" | "arr" };

export type PartialJSONResult<T> = {
  value: T | undefined;
  isPartial: boolean;
};

export function parsePartialJSON<T = unknown>(input: string): PartialJSONResult<T> {
  if (!input || !input.trim()) {
    return { value: undefined, isPartial: true };
  }

  try {
    return { value: JSON.parse(input) as T, isPartial: false };
  } catch {
    // fall through to repair
  }

  const repaired = repair(input);
  try {
    return { value: JSON.parse(repaired) as T, isPartial: true };
  } catch {
    return { value: undefined, isPartial: true };
  }
}

function repair(input: string): string {
  const stack: Frame[] = [];
  let inString = false;
  let escape = false;
  let stringStart = -1;
  let stringIsKey = false;
  // Index where an orphan key starts: a complete string in key position whose
  // colon hasn't arrived yet. Cleared by `:`, `,`, or any container token.
  let pendingKeyStart = -1;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (inString) {
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        if (stringIsKey) pendingKeyStart = stringStart;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      stringStart = i;
      const top = stack[stack.length - 1];
      stringIsKey = top?.type === "obj" && expectingKey(input, i);
      continue;
    }

    if (c === "{") {
      stack.push({ type: "obj" });
      pendingKeyStart = -1;
    } else if (c === "[") {
      stack.push({ type: "arr" });
      pendingKeyStart = -1;
    } else if (c === "}" || c === "]") {
      stack.pop();
      pendingKeyStart = -1;
    } else if (c === ":" || c === ",") {
      pendingKeyStart = -1;
    }
  }

  let out = input;
  let droppedOrphan = false;

  if (inString) {
    if (stringIsKey && stringStart >= 0) {
      // Orphan partial key — drop the half-typed key entirely.
      out = out.slice(0, stringStart);
      droppedOrphan = true;
    } else {
      // Drop a trailing backslash that would otherwise escape our closing quote.
      if (escape) out = out.slice(0, -1);
      out += '"';
    }
  } else if (pendingKeyStart >= 0) {
    // Complete key with no colon yet — drop the orphan.
    out = out.slice(0, pendingKeyStart);
    droppedOrphan = true;
  }

  out = stripTrailingWs(out);

  if (droppedOrphan && out.endsWith(",")) {
    out = out.slice(0, -1);
  } else if (!droppedOrphan) {
    if (out.endsWith(",")) out = out.slice(0, -1);
    if (out.endsWith(":")) out += "null";
    out = trimDanglingLiteral(out);
  }

  while (stack.length) {
    const frame = stack.pop()!;
    out += frame.type === "obj" ? "}" : "]";
  }

  return out;
}

function expectingKey(input: string, stringPos: number): boolean {
  for (let i = stringPos - 1; i >= 0; i--) {
    const c = input[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") continue;
    return c === "{" || c === ",";
  }
  return false;
}

function stripTrailingWs(s: string): string {
  let end = s.length;
  while (end > 0) {
    const c = s[end - 1]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") end--;
    else break;
  }
  return s.slice(0, end);
}

function trimDanglingLiteral(s: string): string {
  // Walk back over a run of value-ish chars (letters, digits, `.`, `-`, `+`).
  // If that run is an incomplete literal or a number ending in `.`, drop it
  // along with a preceding `:` or `,`.
  let end = s.length;
  while (end > 0 && isValueChar(s[end - 1]!)) end--;
  if (end === s.length) return s;

  const tail = s.slice(end);

  if (tail === "" || tail === "true" || tail === "false" || tail === "null") {
    return s;
  }

  // Complete numbers: digits with at most one `.` not at the end, optional leading `-`.
  if (/^-?\d+(?:\.\d+)?$/.test(tail)) return s;

  // Otherwise it's incomplete — drop it.
  let head = stripTrailingWs(s.slice(0, end));
  if (head.endsWith(":")) {
    head = head.slice(0, -1);
    head = stripTrailingWs(head);
    // A `key: <bad>` pair can't be repaired without the key context;
    // strip the key too by walking back through whitespace + a string.
    head = stripTrailingKey(head);
  }
  if (head.endsWith(",")) head = head.slice(0, -1);
  return head;
}

function stripTrailingKey(s: string): string {
  // Expect ...<ws>"<key>"<ws>
  let end = s.length;
  if (end === 0 || s[end - 1] !== '"') return s;
  end--;
  while (end > 0) {
    const c = s[end - 1]!;
    if (c === '"') {
      // Make sure this isn't an escaped quote.
      let backslashes = 0;
      let j = end - 2;
      while (j >= 0 && s[j] === "\\") {
        backslashes++;
        j--;
      }
      if (backslashes % 2 === 0) {
        end--;
        return stripTrailingWs(s.slice(0, end));
      }
    }
    end--;
  }
  return s;
}

function isValueChar(c: string): boolean {
  return (
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9") ||
    c === "." ||
    c === "-" ||
    c === "+"
  );
}
