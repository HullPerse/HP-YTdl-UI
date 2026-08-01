import type { ParsedTitle } from "@/types";

export function sanitizeFilename(name: string): string {
  let s = name.replace(/[\\/:*?"<>|]/g, "_");
  s = s.replace(/^[. ]+|[. ]+$/g, "");
  if (!s) s = "untitled";
  return s.slice(0, 120);
}

export function renderFilenameTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const render = (src: string): string => {
    let i = 0;

    const parse = (depth: number): string => {
      let out = "";
      while (i < src.length) {
        const ch = src[i];
        if (ch === "{") {
          if (src[i + 1] === "{") {
            out += "{";
            i += 2;
            continue;
          }
          i++;
          out += evalToken(parse(depth + 1));
          continue;
        }
        if (ch === "}") {
          if (src[i + 1] === "}") {
            out += "}";
            i += 2;
            continue;
          }
          if (depth > 0) {
            i++;
            return out;
          }
          out += "}";
          i++;
          continue;
        }
        out += ch;
        i++;
      }
      return out;
    };

    const evalToken = (inner: string): string => {
      const m = inner.match(
        /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\?\s*(.*))?$/s,
      );
      if (!m) return "";
      const name = m[1]!;
      const value = vars[name] ?? "";
      const expr = m[2];
      if (expr === undefined) return value;
      return value ? render(expr.trim()) : "";
    };

    return parse(0);
  };

  return render(template).replace(/\s+/g, " ").trim() || "untitled";
}

export function parseYoutubeTitle(rawTitle: string): ParsedTitle {
  let title = rawTitle.trim();

  title = title.replace(/\s*\(official\s*(?:music\s*)?video\)\s*/gi, " ");
  title = title.replace(/\s*\(official\s*audio\)\s*/gi, " ");
  title = title.replace(/\s*\(lyric\s*video\)\s*/gi, " ");
  title = title.replace(/\s*\(visualizer\)\s*/gi, " ");
  title = title.replace(/\s*\(4k\s*remaster\)\s*/gi, " ");
  title = title.replace(/\s*\(4k\)\s*/gi, " ");
  title = title.replace(/\s*\(hd\)\s*/gi, " ");
  title = title.replace(/\s*\(audio\)\s*/gi, " ");

  title = title.replace(/\s*\|\s*.*$/, "");
  title = title.replace(/\s+_\s+.*$/, "");
  title = title.replace(/\s*-\s*youtube\s*$/i, "");

  const miscParts: string[] = [];
  title = title.replace(/\(([^)]*)\)/g, (_, content: string) => {
    const c = content.trim();
    if (c && !/^(official|video|audio|lyric|visualizer|4k|hd)\b/i.test(c)) {
      miscParts.push(c);
    }
    return "";
  });

  title = title.replace(/\s+/g, " ").trim();

  const miscStr = miscParts.length ? ` [${miscParts.join(", ")}]` : "";

  let artist = "";
  let track = title;
  const m = title.match(/^(.+?)\s+-\s+(.+)$/);
  if (m && m[1] && m[2]) {
    artist = m[1].trim();
    track = m[2].trim();
  }

  const filename = artist
    ? `${artist} - ${track}${miscStr}`
    : `${track}${miscStr}`;

  return {
    artist,
    title: track,
    misc: miscParts.join(", "),
    filename: sanitizeFilename(filename),
    source_title: rawTitle,
  };
}
