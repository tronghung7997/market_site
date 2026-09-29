/** Hand-over text of an order that delivered several proxies: one `#NN`
 *  block per proxy (backend proxy_service.compose_delivered_data). Pure. */

export interface ProxyBlock {
  line: number;
  text: string;
  /** `host:port[:user:pass]`, the format proxy tools import. */
  compact: string;
}

const BLOCK_HEADER = /^#(\d{1,3})$/;

function field(text: string, name: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const [key, ...rest] = raw.split(":");
    if (rest.length && key.trim().toLowerCase() === name) return rest.join(":").trim() || null;
  }
  return null;
}

export function compactProxy(text: string): string {
  const host = field(text, "host");
  const port = field(text, "port");
  if (!host || !port) return text.split(/\r?\n/)[0]?.trim() ?? "";
  const user = field(text, "username");
  const pass = field(text, "password");
  return user && pass ? `${host}:${port}:${user}:${pass}` : `${host}:${port}`;
}

/** The proxies of a multi-proxy hand-over, or null for any other text. */
export function splitProxyBlocks(text: string | null | undefined): ProxyBlock[] | null {
  const lines = (text ?? "").split(/\r?\n/);
  if (!BLOCK_HEADER.test(lines[0]?.trim() ?? "")) return null;
  const blocks: ProxyBlock[] = [];
  let current: { line: number; body: string[] } | null = null;
  for (const raw of lines) {
    const header = BLOCK_HEADER.exec(raw.trim());
    if (header) {
      if (current) blocks.push(finish(current));
      current = { line: Number(header[1]), body: [] };
    } else if (current && raw.trim()) {
      current.body.push(raw.trim());
    }
  }
  if (current) blocks.push(finish(current));
  return blocks.length > 1 ? blocks : null;
}

function finish(block: { line: number; body: string[] }): ProxyBlock {
  const text = block.body.join("\n");
  return { line: block.line, text, compact: compactProxy(text) };
}
