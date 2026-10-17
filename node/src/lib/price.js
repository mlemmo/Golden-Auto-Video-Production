// Prices and vehicle names. Port of highestPrice, money, adPrice, title (private/app.php).
import { isNumeric, numberFormat, str, toFloat, trim } from './php.js';

const PRICE_FIELDS = ['VehiclePrice', 'TotalPrice', 'TotalAskingPrice', 'TotalAdvertisingPrice'];

/** Price rule: the highest positive advertised price across the vehicle and its detail-page prices; null when none. */
export function highestPrice(vehicle, detail = []) {
  const p = [];
  for (const v of [vehicle, ...detail]) {
    for (const k of PRICE_FIELDS) {
      if (v && v[k] !== undefined && v[k] !== null && isNumeric(v[k]) && toFloat(v[k]) > 0) p.push(toFloat(v[k]));
    }
  }
  return p.length ? Math.max(...p) : null;
}

/** Dashboard price: "$14,688" or "$14,688.25"; "Call for price" when there is none. */
export function money(p) {
  return p === null || p === undefined ? 'Call for price' : '$' + numberFormat(p, p % 1 === 0 ? 0 : 2);
}

/** Ad-copy price: whole dollars, cents dropped ($14,688.25 → "$14,688"). */
export const adPrice = (p) => '$' + numberFormat(Math.floor(p));

export const title = (v) => trim(str(v.Year ?? '') + ' ' + str(v.Make ?? '') + ' ' + str(v.Model ?? ''));

/** Same advertised price: both "no price" (call for price), or within half a cent. */
export function priceMatches(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return (a === null || a === undefined) && (b === null || b === undefined);
  return Math.abs(toFloat(a) - toFloat(b)) < 0.005;
}
