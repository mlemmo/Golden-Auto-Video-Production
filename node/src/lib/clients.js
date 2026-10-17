// Dealer details for scripts and speech. Port of clientWebsiteSpoken and clientDetails (private/clients.php).
// The rest of clients.php (storage, website analysis) moves with the clients area.
import { DEALER_DEFAULT } from './scripts.js';
import { lower, str, trim } from './php.js';

export const CLIENT_DEFAULT = 'golden-auto';

/** How a website is said: "eleasereturns.com" for client "eLease Returns" → "e lease returns dot com". */
export function clientWebsiteSpoken(website, name) {
  const host = lower(website).replace(/^www\./, '');
  const dot = host.lastIndexOf('.');
  if (dot === -1) return host;
  const label = host.slice(0, dot), tld = host.slice(dot + 1);
  const words = trim(name.replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')).split(/[\t\n\v\f\r ]+/);
  const said = lower(words.join('')) === label.replace(/[-.]/g, '') ? lower(words.join(' ')) : label.replace(/[-.]/g, ' ');
  return said + ' dot ' + tld;
}

/** parse_url($url, PHP_URL_HOST) for the addresses clients are stored with ("https://www.example.com"). */
function urlHost(url) {
  const m = url.match(/^(?:[A-Za-z][A-Za-z0-9+.-]*:)?\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/);
  return m && m[1] !== '' ? m[1] : null;
}

/**
 * Dealer details used in scripts and speech: name, city, website as shown and as spoken. Golden Auto's are fixed;
 * other clients default to their client name, the city found on their website and the website they were added with.
 */
export function clientDetails(client) {
  if (client.id === CLIENT_DEFAULT) return { ...DEALER_DEFAULT, website_spoken: 'my golden auto dot net' };
  const d = client.details ?? {};
  const name = str(d.name ?? client.name);
  const website = str(d.website ?? str(urlHost(str(client.website))).replace(/^www\./, ''));
  return {
    name,
    city: str(d.city ?? client.dealer?.city ?? client.analysis?.dealer?.city ?? ''),
    website,
    website_spoken: str(d.website_spoken ?? clientWebsiteSpoken(website, name)),
  };
}
