// Failed sign-in counter, kept in memory (one portal process on SiteGround): 5 failures per email or 20 per IP
// address within 15 minutes block further tries until the window passes.
const WINDOW_MS = 15 * 60_000;

export function loginLimiter({ perEmail = 5, perIp = 20, now = () => Date.now() } = {}) {
  const hits = new Map();
  const recent = (key) => (hits.get(key) ?? []).filter((t) => now() - t < WINDOW_MS);
  return {
    blocked(email, ip) { return recent('e:' + email).length >= perEmail || recent('i:' + ip).length >= perIp; },
    fail(email, ip) {
      for (const key of ['e:' + email, 'i:' + ip]) hits.set(key, [...recent(key), now()]);
      if (hits.size > 10_000) for (const [k] of hits) if (!recent(k).length) hits.delete(k);
    },
    clear(email) { hits.delete('e:' + email); },
  };
}
