// Outgoing requests of the portal and of opening its orders in the studio: the VIN service (fetchFn) and dealer
// websites and photo hosts (siteFetch). Tests replace them with setPortalDeps so nothing outside is called.
import { clientFetch } from '../lib/clients.js';

export const deps = { fetchFn: (...a) => fetch(...a), siteFetch: (url) => clientFetch(url) };
const listeners = [];
export function setPortalDeps(d) { Object.assign(deps, d); for (const f of listeners) f(); }
/** Called whenever the requests are replaced (the website read keeps its own 15-minute memory). */
export const onDepsChange = (f) => listeners.push(f);
