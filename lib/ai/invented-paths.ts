// Set membership, not judgement: every path-shaped token in an explanation is
// tested against the exact paths the model was shown. Anything else was
// invented. Deterministic on purpose; a detector that guesses is worth nothing.

export interface PathCheck {
  // Path-shaped tokens found, in order of first appearance.
  checked: string[];
  // Not resolved by the parser, but written verbatim in the source the model
  // was shown, e.g. a stylesheet import or a file a script writes. Shown, so
  // not invented, and listed separately because no edge backs them.
  fromSource: string[];
  invented: string[];
}

const EXTENSIONS = [
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "json", "css", "scss", "sass", "less",
  "md", "mdx", "html", "yml", "yaml", "toml", "sql", "graphql", "gql", "prisma", "vue", "svelte", "astro",
];
const PATH_SHAPED = new RegExp(`\\.(?:${EXTENSIONS.join("|")})$`, "i");
const TOKEN = /[^\s`*,;!?"'<>{}]+/g;
// Product names that happen to end in .js, written in prose rather than as paths.
const PRODUCT_NAME = /^(?:Node|Next|Nest|Express|Vue|Nuxt|React|Three|D3|Chart|Ember|Backbone|Angular|Solid|Svelte)\.js$/i;

// A shortened reference to a shown path (its file name, or a tail of it)
// names a real file, so it counts as shown.
function wasShown(token: string, shown: ReadonlySet<string>, tails: ReadonlySet<string>): boolean {
  return shown.has(token) || tails.has(token);
}

function tailsOf(shown: ReadonlySet<string>): Set<string> {
  const tails = new Set<string>();
  for (const path of shown) {
    const parts = path.split("/");
    for (let start = 1; start < parts.length; start += 1) tails.add(parts.slice(start).join("/"));
  }
  return tails;
}

// Peels surrounding punctuation one character at a time, keeping the original
// when it already matches, so app/(group)/page.tsx survives whole.
function variants(token: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < token.length; start += 1) {
    if (start > 0 && !"([".includes(token[start - 1])) break;
    for (let end = token.length; end > start; end -= 1) {
      if (end < token.length && !".,:)]".includes(token[end])) break;
      const candidate = token.slice(start, end);
      out.push(candidate.startsWith("./") ? candidate.slice(2) : candidate);
    }
  }
  return out;
}

// Path-shaped tokens written in source code: import specifiers, string
// literals, comments. Taken from exactly the source text the model was shown.
export function pathsInSource(source: string): string[] {
  const found = new Set<string>();
  for (const [token] of source.matchAll(TOKEN)) {
    if (token.includes("://")) continue;
    const shaped = variants(token).find((option) => PATH_SHAPED.test(option) && !/^[([]/.test(option));
    if (shaped) found.add(shaped.replace(/^(?:\.\.?\/)+/, ""));
  }
  return [...found].sort();
}

export function findInventedPaths(text: string, shownPaths: Iterable<string>, sourcePaths: Iterable<string> = []): PathCheck {
  const shown = new Set(shownPaths);
  const tails = tailsOf(shown);
  const inSource = new Set(sourcePaths);
  const sourceTails = tailsOf(inSource);
  const checked: string[] = [];
  const fromSource: string[] = [];
  const invented: string[] = [];
  const note = (path: string, list?: string[]) => {
    if (!checked.includes(path)) checked.push(path);
    if (list && !list.includes(path)) list.push(path);
  };

  const spans = text.split("`");
  spans.forEach((span, position) => {
    const inCode = position % 2 === 1;
    for (const [token] of span.matchAll(TOKEN)) {
      if (token.includes("://")) continue;
      const options = variants(token);
      const match = options.find((option) => wasShown(option, shown, tails));
      if (match) {
        note(match);
        continue;
      }
      const literal = options.find((option) => wasShown(option.replace(/^(?:\.\.?\/)+/, ""), inSource, sourceTails));
      if (literal) {
        note(literal.replace(/^(?:\.\.?\/)+/, ""), fromSource);
        continue;
      }
      const shaped = options.find((option) => PATH_SHAPED.test(option) && !/^[.([]/.test(option));
      if (!shaped) continue;
      if (!inCode && !shaped.includes("/") && PRODUCT_NAME.test(shaped)) continue;
      note(shaped, invented);
    }
  });
  return { checked, fromSource, invented };
}

// The check as a score on one explanation: 1 when it named nothing it wasn't
// shown, 0 otherwise. The comment lists the offending paths so a flag can be
// confirmed by eye.
export function inventedPathCheck(text: string, shownPaths: Iterable<string>, sourcePaths: Iterable<string> = []): { key: string; score: number; comment: string } {
  const { checked, fromSource, invented } = findInventedPaths(text, shownPaths, sourcePaths);
  const literal = fromSource.length > 0 ? ` ${fromSource.length} only in the source: ${fromSource.join(", ")}.` : "";
  return {
    key: "no_invented_paths",
    score: invented.length === 0 ? 1 : 0,
    comment: invented.length > 0
      ? `Named but never shown: ${invented.join(", ")}.${literal}`
      : `${checked.length} path${checked.length === 1 ? "" : "s"} named, all shown.${literal}`,
  };
}
