// Car photos are shrunk and re-saved as JPEG in the browser before upload (the portal stores only JPEG): the photo at
// most 2400 px on its longest side, and a 480 px thumbnail for the portal's own pages. Re-saving also drops the
// camera's location and other metadata.
import { upload } from './api.js';

async function jpeg(bitmap, longest, quality) {
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('This photo could not be read.'))), 'image/jpeg', quality));
}

/** Uploads one photo for the order being filled in: the shrunk photo, then its thumbnail. Returns its id. */
export async function uploadPhoto(dealerId, file) {
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`${file.name} is not a photo this browser can read (use JPEG or PNG).`); }
  try {
    const full = await jpeg(bitmap, 2400, 0.88);
    const thumb = await jpeg(bitmap, 480, 0.8);
    const base = `/api/dealers/${dealerId}/uploads`;
    const { photo_id: id } = await upload(base, full);
    await upload(`${base}/${id}/thumb`, thumb);
    return id;
  } finally {
    bitmap.close?.();
  }
}
