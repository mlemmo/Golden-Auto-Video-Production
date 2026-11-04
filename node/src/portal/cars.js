// LotSpotlight portal: checking a car's details as the customer typed or edited them on the order form.
import { HttpError } from '../lib/auth.js';

export const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const MAX_PHOTOS = 30;
export const EDITABLE = ['stock_no', 'year', 'make', 'model', 'trim', 'color', 'drivetrain', 'mileage', 'price', 'description', 'page_url'];
const TEXT = { stock_no: 40, make: 60, model: 80, trim: 120, color: 60, drivetrain: 40, description: 5000, page_url: 500 };
const NAMES = { stock_no: 'stock number', make: 'make', model: 'model', trim: 'trim', color: 'colour', drivetrain: 'drive', description: 'description', page_url: 'car page address' };
export const HTTPS = /^https:\/\/[^\s"'<>]+$/;

export function cleanVin(vin) {
  const v = String(vin ?? '').trim().toUpperCase();
  if (!VIN.test(v)) throw new HttpError(400, 'Enter the 17-character VIN (letters and numbers; never I, O or Q).');
  return v;
}

/** A whole number from a number or text such as "$14,688" or "52,000 mi"; null when empty. */
function wholeNumber(value, label, min, max) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]|mi(les)?$/gi, ''));
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Enter the ${label} as a number from ${min.toLocaleString('en-US')} to ${max.toLocaleString('en-US')}.`);
  return Math.round(n);
}

/** The car's fields, checked: year, make and model are required, the rest optional. */
export function cleanFields(input) {
  const out = {};
  for (const key of EDITABLE) {
    const value = input?.[key];
    if (key === 'year') out.year = wholeNumber(value, 'year', 1900, new Date().getUTCFullYear() + 2);
    else if (key === 'mileage') out.mileage = wholeNumber(value, 'miles', 0, 2_000_000);
    else if (key === 'price') out.price = wholeNumber(value, 'price in whole dollars', 0, 10_000_000);
    else {
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (text.length > TEXT[key]) throw new HttpError(400, `The ${NAMES[key]} is too long (up to ${TEXT[key]} characters).`);
      if (key === 'page_url' && text !== '' && !HTTPS.test(text)) throw new HttpError(400, 'The car page address must start with https://');
      out[key] = text === '' ? null : text;
    }
  }
  for (const key of ['year', 'make', 'model']) if (out[key] === null) throw new HttpError(400, `Enter the ${NAMES[key] ?? key}.`);
  return out;
}
