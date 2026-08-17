export async function getJson(url: string, headers: Record<string,string> = {}, timeoutMs = 7000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    if (!r.ok) {
      const text = (await r.text()).replace(/\s+/g, " ").trim();
      const short = text.length > 240 ? `${text.slice(0,240)}…` : text;
      throw new Error(`${r.status}${short ? ` ${short}` : ""}`);
    }
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function postJson(url: string, body: unknown, headers: Record<string,string> = {}, timeoutMs = 12000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const text = (await r.text()).replace(/\s+/g, " ").trim();
      const short = text.length > 240 ? `${text.slice(0,240)}…` : text;
      throw new Error(`${r.status}${short ? ` ${short}` : ""}`);
    }
    return await r.json();
  } finally { clearTimeout(t); }
}
