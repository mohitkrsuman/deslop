// The explanation prompt permits inline code, bullets and bold. Those three are
// rendered; anything else a model emits anyway (headings, numbered lists,
// italics, stray markers) has its markers dropped, so no raw syntax reaches
// the pane. Repository paths become links.

export type PathKind = "file" | "folder";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "path"; path: string; target: PathKind; code: boolean };

export type Block =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "bullets"; items: Inline[][] };

export type ResolvePath = (candidate: string) => PathKind | null;

const BULLET = /^\s*(?:[-*•+]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+/;
// Runs of characters a path can contain. Punctuation around it is peeled off below.
const PATH_LIKE = /[^\s`*,;!?"'<>{}]+/g;

function resolveLoose(token: string, resolve: ResolvePath, inProse: boolean): { path: string; target: PathKind; before: string; after: string } | null {
  // A bare word like "app" can be a folder; only link folders in prose when
  // they read as paths, or inside code where the model marked them as one.
  const accept = (candidate: string) => {
    const target = resolve(candidate);
    if (!target) return null;
    if (inProse && target === "folder" && !candidate.includes("/")) return null;
    return target;
  };
  // Try the token whole, then with opening brackets peeled from the front and
  // punctuation peeled from the back. Peeling stops at any other character, so
  // a real path containing brackets, like app/(group)/page.tsx, matches whole.
  for (let start = 0; start < token.length; start += 1) {
    if (start > 0 && !"([".includes(token[start - 1])) break;
    for (let end = token.length; end > start; end -= 1) {
      if (end < token.length && !".,:)]".includes(token[end])) break;
      const candidate = token.slice(start, end);
      const path = candidate.startsWith("./") ? candidate.slice(2) : candidate;
      const target = accept(path);
      if (target) return { path, target, before: token.slice(0, start), after: token.slice(end) };
    }
  }
  return null;
}

function linkPaths(text: string, resolve: ResolvePath): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  const push = (value: string) => {
    if (!value) return;
    const previous = out.at(-1);
    if (previous?.kind === "text") previous.text += value;
    else out.push({ kind: "text", text: value });
  };
  for (const match of text.matchAll(PATH_LIKE)) {
    const found = resolveLoose(match[0], resolve, true);
    if (!found) continue;
    push(text.slice(last, match.index) + found.before);
    out.push({ kind: "path", path: found.path, target: found.target, code: false });
    push(found.after);
    last = match.index + match[0].length;
  }
  push(text.slice(last));
  return out;
}

export function parseInline(source: string, resolve: ResolvePath): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push(...linkPaths(buffer, resolve));
    buffer = "";
  };
  let index = 0;
  while (index < source.length) {
    if (source[index] === "`") {
      const close = source.indexOf("`", index + 1);
      if (close > index + 1) {
        flush();
        const inner = source.slice(index + 1, close);
        const found = resolveLoose(inner.trim(), resolve, false);
        out.push(found && !found.before && !found.after
          ? { kind: "path", path: found.path, target: found.target, code: true }
          : { kind: "code", text: inner });
        index = close + 1;
      } else index += close === index + 1 ? 2 : 1;
      continue;
    }
    if (source.startsWith("**", index)) {
      const close = source.indexOf("**", index + 2);
      if (close > index + 2) {
        flush();
        out.push({ kind: "bold", children: parseInline(source.slice(index + 2, close), resolve) });
        index = close + 2;
      } else index += 2;
      continue;
    }
    // A lone asterisk is italics or a stray marker; either way it isn't shown.
    if (source[index] === "*") {
      index += 1;
      continue;
    }
    buffer += source[index];
    index += 1;
  }
  flush();
  return out;
}

export function parseExplanation(text: string, resolve: ResolvePath): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];
  const close = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", inlines: parseInline(paragraph.join(" "), resolve) });
    if (bullets.length > 0) blocks.push({ kind: "bullets", items: bullets.map((item) => parseInline(item, resolve)) });
    paragraph = [];
    bullets = [];
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || /^([-*_])\1{2,}$/.test(line)) {
      close();
    } else if (HEADING.test(line)) {
      close();
      paragraph.push(line.replace(HEADING, ""));
      close();
    } else if (BULLET.test(line)) {
      if (paragraph.length > 0) close();
      bullets.push(line.replace(BULLET, ""));
    } else if (bullets.length > 0 && /^\s{2,}/.test(raw)) {
      bullets[bullets.length - 1] += ` ${line}`;
    } else {
      if (bullets.length > 0) close();
      paragraph.push(line);
    }
  }
  close();
  return blocks;
}
