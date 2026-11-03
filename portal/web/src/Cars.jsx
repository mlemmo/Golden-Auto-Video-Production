// Cars: the dealer's cars with videos (stored when ordered), the cars on their website right now (read live, never
// saved), and the order form: details (VIN lookup for cars added by hand), photos, video type. Everyone at the dealer
// sees the lists; owners and admins order.
import { useCallback, useEffect, useState } from 'react';
import { api, apiUrl } from './api.js';
import { uploadPhoto } from './photos.js';
import { carTitle, StatusPill } from './Orders.jsx';

const FIELDS = [
  ['year', 'Year', 'number'], ['make', 'Make'], ['model', 'Model'], ['trim', 'Trim'], ['color', 'Colour'], ['drivetrain', 'Drive'],
  ['mileage', 'Miles', 'number'], ['price', 'Price ($)', 'number'], ['stock_no', 'Stock number'], ['page_url', 'Car page on your website'],
];
const EMPTY = Object.fromEntries([...FIELDS.map(([k]) => [k, '']), ['description', ''], ['vin', '']]);
const MAX_PHOTOS = 30;
const dollars = (n) => (n === null || n === undefined ? '' : '$' + Number(n).toLocaleString('en-US'));
const miles = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US') + ' mi');
const formOf = (car) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, car?.[k] ?? '']));

/** A car card: photo, name, price and miles, its latest order. */
function CarCard({ car, photo, onClick, action }) {
  return (
    <button className="car" onClick={onClick}>
      {photo ? <img src={apiUrl(photo)} alt="" loading="lazy" /> : <span className="no-photo">No photo</span>}
      <span className="car-text">
        <strong>{carTitle(car)}</strong>
        <span className="muted small">{[dollars(car.price), miles(car.mileage), car.stock_no && `stock ${car.stock_no}`].filter(Boolean).join(' · ')}</span>
        <span className="badges">{car.order_status && <StatusPill status={car.order_status} />}{action && <span className="pill action">{action}</span>}</span>
      </span>
    </button>
  );
}

function OrderForm({ dealerId, start, onDone, onCancel }) {
  const byHand = start.source === 'form' && !start.car;
  const [form, setForm] = useState(formOf(start.car));
  const [photos, setPhotos] = useState(start.photos);   // [{ url } | { upload_id, thumb }] in order
  const [products, setProducts] = useState(null);
  const [product, setProduct] = useState('ai_video');
  const [length, setLength] = useState(30);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { api('GET', `/api/dealers/${dealerId}/products`).then((d) => setProducts(d.products), (e) => setError(e.message)); }, [dealerId]);
  const field = (k) => ({ id: `order-${k}`, value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  async function lookUp() {
    setError(''); setNote('');
    try {
      const { vehicle } = await api('GET', `/api/dealers/${dealerId}/vin/${encodeURIComponent(form.vin.trim())}`);
      setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(vehicle).filter(([, v]) => v !== null)) }));
      setNote('Filled in from the VIN. Check the details before ordering.');
    } catch (e) { setError(e.message); }
  }
  async function add(files) {
    setError('');
    const list = [...files].slice(0, MAX_PHOTOS - photos.length);
    for (const [i, f] of list.entries()) {
      setBusy(`Uploading photo ${i + 1} of ${list.length}…`);
      try {
        const id = await uploadPhoto(dealerId, f);
        setPhotos((p) => [...p, { upload_id: id, thumb: `/api/dealers/${dealerId}/photos/${id}?size=thumb`, fresh: true }]);
      } catch (e) { setError(e.message); break; }
    }
    setBusy('');
  }
  function move(i, by) {
    const next = [...photos];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setPhotos(next);
  }
  function drop(i) {
    const p = photos[i];
    setPhotos(photos.filter((_, j) => j !== i));
    // A photo uploaded just now for this order is deleted; the photos of an ordered car simply stay out of this order.
    if (p.fresh) api('DELETE', `/api/dealers/${dealerId}/uploads/${p.upload_id}`).catch(() => {});
  }
  async function submit(e) {
    e.preventDefault();
    setError(''); setNote('');
    setBusy('Placing the order…');
    try {
      const { order } = await api('POST', `/api/dealers/${dealerId}/orders`, {
        car: form, photos: photos.map((p) => (p.upload_id ? { upload_id: p.upload_id } : { url: p.url })), source: start.source, product, length_s: length, notes,
      });
      onDone(`Order ${order.id} placed: ${order.product_name} of the ${carTitle(order.vehicle)}. We start once it is paid.`);
    } catch (err) { setError(err.message); setBusy(''); }
  }
  const lengths = products?.[product]?.lengths ?? [];
  return (
    <form className="card car-editor form" onSubmit={submit}>
      <div className="row"><h2>{byHand ? 'Order a video of a car not on your website' : `Order a video: ${carTitle(start.car)}`}</h2><button type="button" className="link" onClick={onCancel}>Back to cars</button></div>
      <p className="muted small">Check the details: the video says what is written here. Changes are saved with the order, not on your website.</p>
      <div className="vin-row">
        <label>VIN<input {...field('vin')} maxLength={17} required disabled={!byHand} autoFocus={byHand} style={{ textTransform: 'uppercase' }} /></label>
        {byHand && <button type="button" className="secondary" onClick={lookUp} disabled={form.vin.trim().length !== 17}>Look up</button>}
      </div>
      <div className="grid">
        {FIELDS.map(([k, label, type]) => <label key={k}>{label}<input {...field(k)} inputMode={type === 'number' ? 'numeric' : undefined} required={['year', 'make', 'model'].includes(k)} /></label>)}
      </div>
      <label>Description<textarea {...field('description')} rows={4} maxLength={5000} /></label>

      <section className="photos">
        <h3>Photos <span className="muted small">{photos.length} of {MAX_PHOTOS} · the first ones are used most; four or more (front, both sides, rear) work best</span></h3>
        <div className="photo-grid">
          {photos.map((p, i) => (
            <figure key={p.upload_id ?? p.url}>
              <img src={apiUrl(p.thumb ?? p.url)} alt={`Photo ${i + 1}`} loading="lazy" />
              <figcaption>
                <button type="button" className="link" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
                <button type="button" className="link" aria-label="Move later" disabled={i === photos.length - 1} onClick={() => move(i, 1)}>→</button>
                <button type="button" className="link" aria-label="Leave this photo out" onClick={() => drop(i)}>Remove</button>
              </figcaption>
            </figure>
          ))}
        </div>
        {photos.length < MAX_PHOTOS && <label className="upload">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>}
      </section>

      {products && (
        <div className="grid">
          <label>Video<select value={product} onChange={(e) => { setProduct(e.target.value); if (!products[e.target.value].lengths.includes(length)) setLength(products[e.target.value].lengths.at(-1)); }}>
            {Object.entries(products).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select></label>
          <label>Length<select value={length} onChange={(e) => setLength(Number(e.target.value))}>
            {lengths.map((n) => <option key={n} value={n}>{n} seconds</option>)}
          </select></label>
        </div>
      )}
      <label>Notes for us <span className="muted small">(optional)</span><textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to mention or leave out" /></label>
      {error && <p className="error">{error}</p>}
      {note && <p className="ok">{note}</p>}
      {busy && <p className="muted small">{busy}</p>}
      <div className="actions"><button disabled={!!busy || photos.length === 0}>Place order</button>{photos.length === 0 && <span className="muted small">Add at least one photo.</span>}</div>
    </form>
  );
}

function WebsiteCars({ dealerId, canOrder, onOrder }) {
  const [read, setRead] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(async (fresh = false) => {
    setLoading(true); setError('');
    try { setRead(await api('GET', `/api/dealers/${dealerId}/website-cars${fresh ? '?fresh=1' : ''}`)); } catch (e) { setError(e.message); }
    setLoading(false);
  }, [dealerId]);
  useEffect(() => { setRead(null); load(); }, [load]);
  return (
    <section className="card">
      <div className="row">
        <h2>On your website {read?.cars?.length > 0 && <span className="muted small">{read.cars.length}</span>}</h2>
        <button className="secondary small" disabled={loading} onClick={() => load(true)}>{loading ? 'Reading…' : 'Refresh'}</button>
      </div>
      {loading && !read && <p className="muted">Reading your website… this can take a few seconds.</p>}
      {read?.message && <p className="note small">{read.message}</p>}
      {read?.read_at && <p className="muted small">Read from {read.website?.replace('https://', '')} at {new Date(read.read_at).toLocaleTimeString()}. Nothing is saved until you order.</p>}
      {error && <p className="error">{error}</p>}
      {read?.status === 'ok' && read.cars.length === 0 && <p className="muted">No cars were found on your website.</p>}
      {read?.cars?.length > 0 && (
        <div className="car-list">
          {read.cars.map((c) => <CarCard key={c.vin} car={c} photo={c.photos[0]} action={canOrder ? 'Order a video' : null} onClick={() => canOrder && onOrder({ car: c, photos: c.photos.map((url) => ({ url })), source: 'website' })} />)}
        </div>
      )}
      {read?.errors?.length > 0 && <details className="small"><summary>{read.errors.length} page(s) could not be read</summary><ul>{read.errors.map((e) => <li key={e}>{e}</li>)}</ul></details>}
    </section>
  );
}

export function Cars({ dealerId, role }) {
  const canOrder = ['staff', 'owner', 'admin'].includes(role);
  const [ordered, setOrdered] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [ordering, setOrdering] = useState(null);   // { car, photos, source } while the order form is open
  const load = useCallback(() => api('GET', `/api/dealers/${dealerId}/vehicles`).then((d) => { setOrdered(d.vehicles); setError(''); }, (e) => setError(e.message)), [dealerId]);
  useEffect(() => { load(); setOrdering(null); setDone(''); }, [load]);

  async function orderAgain(v) {
    try {
      const { vehicle } = await api('GET', `/api/dealers/${dealerId}/vehicles/${v.id}`);
      setOrdering({ car: vehicle, source: vehicle.source === 'website' ? 'website' : 'form', photos: vehicle.photos.map((p) => (p.uploaded ? { upload_id: p.id, thumb: p.thumb } : { url: p.url })) });
    } catch (e) { setError(e.message); }
  }
  if (ordering) return <OrderForm dealerId={dealerId} start={ordering} onCancel={() => setOrdering(null)} onDone={(msg) => { setOrdering(null); setDone(msg); load(); }} />;
  return (
    <>
      {done && <p className="card ok">{done}</p>}
      <section className="card">
        <div className="row">
          <h2>Cars with videos {ordered && <span className="muted small">{ordered.length}</span>}</h2>
          {canOrder && <button onClick={() => { setDone(''); setOrdering({ car: null, photos: [], source: 'form' }); }}>Add a car by hand</button>}
        </div>
        {error && <p className="error">{error}</p>}
        {ordered === null ? <p className="muted">Loading…</p> : ordered.length === 0 ? <p className="muted">No videos ordered yet. Pick a car from your website below, or add one by hand.</p> : (
          <div className="car-list">
            {ordered.map((v) => <CarCard key={v.id} car={v} photo={v.photo?.thumb} action={canOrder ? 'Order again' : null} onClick={() => canOrder && orderAgain(v)} />)}
          </div>
        )}
      </section>
      <WebsiteCars dealerId={dealerId} canOrder={canOrder} onOrder={(o) => { setDone(''); setOrdering(o); }} />
    </>
  );
}
