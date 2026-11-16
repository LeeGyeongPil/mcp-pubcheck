/** Result of looking for the `mcp-name: <name>` ownership token in a README. */
export type McpNameStatus =
  | { status: "ok" }
  | { status: "glued"; char: string }
  | { status: "case-only" }
  | { status: "spacing" }
  | { status: "different"; found: string }
  | { status: "missing" };

const NAME_CHAR = /[A-Za-z0-9._/-]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Find the ownership token for `name` in `text`.
 *
 * The token is `mcp-name: ` (one space) followed by the exact server name. The character after the
 * name must not continue a server name ([A-Za-z0-9._/-]) unless it starts an HTML comment end `-->`.
 */
export function matchMcpName(text: string, name: string): McpNameStatus {
  const token = `mcp-name: ${name}`;
  let glued: string | undefined;
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) break;
    const rest = text.slice(at + token.length);
    const next = rest[0];
    if (next === undefined || !NAME_CHAR.test(next) || rest.startsWith("-->")) return { status: "ok" };
    glued ??= next;
    from = at + 1;
  }
  if (glued !== undefined) return { status: "glued", char: glued };

  // Same token, different capitalisation.
  const lower = text.toLowerCase();
  if (lower.includes(token.toLowerCase())) return { status: "case-only" };

  // Right name but wrong whitespace after the colon.
  if (new RegExp(`mcp-name:[ \\t]*${escapeRegExp(name)}`, "i").test(text)) return { status: "spacing" };

  const other = /mcp-name:[ \t]*([A-Za-z0-9._/-]+)/.exec(text);
  if (other?.[1]) return { status: "different", found: other[1] };
  return { status: "missing" };
}
