// Warm-instance cache: bounded, short-lived, and shared by concurrent requests.
const cache = new Map();
const pending = new Map();
export function forgetChapter(id) { cache.delete(id); }
export async function getChapterServer(id) {
  const hit = cache.get(id);
  if (hit && hit.expires > Date.now()) return hit.data;
  if (pending.has(id)) return pending.get(id);
  const task = (async () => {
    let r;
    try {
      r = await fetch('https://api.mangadex.org/at-home/server/' + id + '?forcePort443=true', {
        headers: { Accept: 'application/json', 'User-Agent': 'MangaDownloader/6.0' },
        cache: 'no-store', signal: AbortSignal.timeout(10000)
      });
    } catch (cause) {
      throw Object.assign(new Error('MangaDex metadata connection failed: ' + cause.message), { status: 502 });
    }
    if (!r.ok) throw Object.assign(new Error('MangaDex metadata: HTTP ' + r.status), {
      status: r.status === 429 ? 429 : 502,
      upstreamStatus: r.status, retryAfter: r.headers.get('retry-after')
    });
    const data = await r.json();
    if (data.result !== 'ok' || !data.baseUrl || !data.chapter?.hash || !Array.isArray(data.chapter.data))
      throw Object.assign(new Error('MangaDex returned invalid chapter metadata.'), { status: 502 });
    const base = new URL(data.baseUrl);
    if (base.protocol !== 'https:') throw new Error('Invalid MangaDex image server protocol.');
    if (cache.size >= 100) cache.delete(cache.keys().next().value);
    cache.set(id, { data, expires: Date.now() + 60000 });
    return data;
  })();
  pending.set(id, task);
  try { return await task; } finally { pending.delete(id); }
}
