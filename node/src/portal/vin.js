// Year, make, model, trim and drive from a VIN, using the free NHTSA vPIC service (no key). Only fills in the car
// form; the customer checks and edits the result. fetchFn is replaceable in tests (never call NHTSA from tests).
import { HttpError } from '../lib/auth.js';
import { cleanVin } from './cars.js';

export async function decodeVin(vin, fetchFn = fetch) {
  const v = cleanVin(vin);
  let data;
  try {
    const res = await fetchFn(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${v}?format=json`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json())?.Results?.[0] ?? {};
  } catch {
    throw new HttpError(502, 'The VIN lookup did not answer. Type the details in instead.');
  }
  const text = (s) => (typeof s === 'string' && s.trim() !== '' ? s.trim() : null);
  const year = Number(data.ModelYear);
  const out = { year: Number.isInteger(year) && year >= 1900 ? year : null, make: text(data.Make), model: text(data.Model), trim: text(data.Trim), drivetrain: text(data.DriveType) };
  if (!out.make && !out.model) throw new HttpError(404, 'That VIN was not found. Check it, or type the details in.');
  return out;
}
