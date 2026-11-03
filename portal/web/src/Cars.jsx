// Cars: the dealer's cars, "Pull from my website" (read a few pages per request until done), the car form (VIN
// lookup, details, photos) and ordering a video. Viewers read; owners, admins and approvers change cars; owners and
// admins order.
import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { uploadPhoto } from './photos.js';
import { carTitle, StatusPill } from './Orders.jsx';

const FIELDS = [
  ['year', 'Year', 'number'], ['make', 'Make'], ['model', 'Model'], ['trim', 'Trim'], ['color', 'Colour'], ['drivetrain', 'Drive'],
  ['mileage', 'Miles', 'number'], ['price', 'Price ($)', 'number'], ['stock_no', 'Stock number'], ['page_url', 'Car page on your website'],
];
const EMPTY = Object.fromEntries([...FIELDS.map(([k]) => [k, '']), ['description', ''], ['vin', '']]);
const dollars = (n) => (n === null || n === undefined ? '' : '$' + Number(n).toLocaleString('en-US'));
const miles = (n) => (n === null || n === undefined ? '' : Number(n).toLocaleString('en-US') + ' mi');
const fromCar = (v) => Object.fromEntries(Object.keys(EMPTY).map((k) => [k, v[k] ?? '']));

function Pull({ dealerId, canEdit, onCars }) {
  const [pull, setPull] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('GET', `/api/dealers/${dealerId}/pulls/latest`).then((d) => setPull(d.pull), () => {}); }, [dealerId]);
  // A running pull is kept going from this page, one batch of pages per request.
  useEffect(() => {
    if (pull?.status !== 'running') return undefined;
    let stop = false;
    (async () => {
      let p = pull;
      while (!stop && p.status === 'running') {
        const before = p.done;
        try { p = (await api('POST', `/api/dealers/${dealerId}/pulls/${p.id}/continue`, {})).pull; }
        catch (e) { setError(e.message); return; }
        if (!stop) { setPull(p); onCars(); }
        // No progress: another tab is reading this batch; wait before asking again.
        if (p.status === 'running' && p.done === before) await new Promise((r) => setTimeout(r, 3000));
      }
    })();
    return () => { stop = true; };
  }, [pull?.id, pull?.status === 'running']); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    setError('');
    try { setPull((await api('POST', `/api/dealers/${dealerId}/pulls`, {})).pull); } catch (e) { setError(e.message); }
  }
  const p = pull;
  return (
    <div className="pull">
      {canEdit && <button className="secondary" disabled={p?.status === 'running'} onClick={start}>{p?.status === 'running' ? 'Reading your website…' : 'Pull from my website'}</button>}
      {p && p.status === 'running' && <p className="muted small">Reading car pages: {p.done} of {p.total}. Keep this page open until it finishes.</p>}
      {p && p.status === 'done' && <p className="muted small">Last pull {new Date(p.finished_at).toLocaleString()}: {p.added} new, {p.changed} updated, {p.gone} no longer on your website.{p.errors.length ? ` ${p.errors.length} page(s) could not be read.` : ''}</p>}
      {p && ['blocked', 'failed'].includes(p.status) && <p className="note small">{p.message}</p>}
      {p?.errors?.length > 0 && p.status !== 'running' && <details className="small"><summary>Pages that could not be read</summary><ul>{p.errors.map((e) => <li key={e}>{e}</li>)}</ul></details>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Photos({ dealerId, car, canEdit, onChange }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const base = `/api/dealers/${dealerId}/vehicles/${car.id}/photos`;
  async function add(files) {
    setError('');
    const list = [...files];
    try {
      for (const [i, f] of list.entries()) { setBusy(`Uploading photo ${i + 1} of ${list.length}…`); await uploadPhoto(dealerId, car.id, f); }
    } catch (e) { setError(e.message); }
    setBusy('');
    onChange();
  }
  async function move(i, by) {
    const ids = car.photos.map((p) => p.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    try { await api('PUT', `${base}/order`, { ids }); onChange(); } catch (e) { setError(e.message); }
  }
  async function remove(p) {
    try { await api('DELETE', `${base}/${p.id}`); onChange(); } catch (e) { setError(e.message); }
  }
  return (
    <section className="photos">
      <h3>Photos <span className="muted small">{car.photos.length} of 30 · the first photos are used most</span></h3>
      {car.photos.length === 0 && <p className="muted">No photos yet. A video needs at least one; four or more (front, both sides, rear) work best.</p>}
      <div className="photo-grid">
        {car.photos.map((p, i) => (
          <figure key={p.id}>
            <img src={p.thumb} alt={`Photo ${i + 1}`} loading="lazy" />
            {canEdit && (
              <figcaption>
                <button className="link" aria-label="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>←</button>
                <button className="link" aria-label="Move later" disabled={i === car.photos.length - 1} onClick={() => move(i, 1)}>→</button>
                <button className="link" aria-label="Delete photo" onClick={() => remove(p)}>Delete</button>
              </figcaption>
            )}
          </figure>
        ))}
      </div>
      {canEdit && car.photos.length < 30 && (
        <label className="upload">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={!!busy} onChange={(e) => { add(e.target.files); e.target.value = ''; }} /></label>
      )}
      {busy && <p className="muted small">{busy}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function OrderForm({ dealerId, car, onOrdered }) {
  const [products, setProducts] = useState(null);
  const [product, setProduct] = useState('ai_video');
  const [length, setLength] = useState(30);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  useEffect(() => { api('GET', `/api/dealers/${dealerId}/products`).then((d) => setProducts(d.products), (e) => setError(e.message)); }, [dealerId]);
  if (!products) return null;
  const lengths = products[product]?.lengths ?? [];
  async function submit(e) {
    e.preventDefault();
    setError(''); setDone('');
    try {
      const { order } = await api('POST', `/api/dealers/${dealerId}/orders`, { vehicle_id: car.id, product, length_s: length, notes });
      setDone(`Order ${order.id} placed. We start once it is paid.`); setNotes(''); onOrdered();
    } catch (err) { setError(err.message); }
  }
  return (
    <form className="order-form" onSubmit={submit}>
      <h3>Order a video of this car</h3>
      <div className="grid">
        <label>Video<select value={product} onChange={(e) => { setProduct(e.target.value); if (!products[e.target.value].lengths.includes(length)) setLength(products[e.target.value].lengths.at(-1)); }}>
          {Object.entries(products).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
        </select></label>
        <label>Length<select value={length} onChange={(e) => setLength(Number(e.target.value))}>
          {lengths.map((n) => <option key={n} value={n}>{n} seconds</option>)}
        </select></label>
      </div>
      <label>Notes for us <span className="muted small">(optional)</span><textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to mention or leave out" /></label>
      {error && <p className="error">{error}</p>}
      {done && <p className="ok">{done}</p>}
      <div className="actions"><button disabled={car.photos.length === 0}>Place order</button>{car.photos.length === 0 && <span className="muted small">Add a photo first.</span>}</div>
    </form>
  );
}

function CarEditor({ dealerId, carId, canEdit, canOrder, onClose, onSaved }) {
  const isNew = carId === 'new';
  const [car, setCar] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const load = useCallback(async (id = carId) => {
    const { vehicle } = await api('GET', `/api/dealers/${dealerId}/vehicles/${id}`);
    setCar(vehicle); setForm(fromCar(vehicle));
  }, [dealerId, carId]);
  useEffect(() => { if (!isNew) load().catch((e) => setError(e.message)); }, [isNew, load]);
  const field = (k) => ({ id: `car-${k}`, value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }), disabled: !canEdit });

  async function lookUp() {
    setError(''); setNote('');
    try {
      const { vehicle } = await api('GET', `/api/dealers/${dealerId}/vin/${encodeURIComponent(form.vin.trim())}`);
      setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(vehicle).filter(([, v]) => v !== null)) }));
      setNote('Filled in from the VIN. Check the details before saving.');
    } catch (e) { setError(e.message); }
  }
  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(''); setNote('');
    const first = car === null;
    const body = Object.fromEntries(Object.entries(form).filter(([k]) => k !== 'vin' || first));
    try {
      const { vehicle } = first ? await api('POST', `/api/dealers/${dealerId}/vehicles`, body) : await api('PATCH', `/api/dealers/${dealerId}/vehicles/${car.id}`, body);
      onSaved(vehicle.id);
      setCar(vehicle); setForm(fromCar(vehicle));
      setNote(first ? 'Car added. Now add its photos.' : 'Saved.');
    } catch (err) { setError(err.message); }
    setBusy(false);
  }
  async function remove() {
    try { await api('DELETE', `/api/dealers/${dealerId}/vehicles/${car.id}`); onSaved(null); onClose(); } catch (e) { setError(e.message); }
  }
  if (!isNew && !car) return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</section>;
  const added = car !== null;
  return (
    <section className="card car-editor">
      <div className="row"><h2>{added ? carTitle(car) : 'Add a car'}</h2><button className="link" onClick={onClose}>Back to cars</button></div>
      {car?.missing_since && <p className="note small">This car was not on your website at the last pull. Remove it if it is sold; otherwise you can keep it.</p>}
      <form className="form" onSubmit={save}>
        <div className="vin-row">
          <label>VIN<input {...field('vin')} maxLength={17} required disabled={!isNew || added || !canEdit} autoFocus={isNew} style={{ textTransform: 'uppercase' }} /></label>
          {isNew && !added && <button type="button" className="secondary" onClick={lookUp} disabled={form.vin.trim().length !== 17}>Look up</button>}
        </div>
        <div className="grid">
          {FIELDS.map(([k, label, type]) => <label key={k}>{label}<input {...field(k)} inputMode={type === 'number' ? 'numeric' : undefined} /></label>)}
        </div>
        <label>Description<textarea {...field('description')} rows={4} maxLength={5000} /></label>
        {error && <p className="error">{error}</p>}
        {note && <p className="ok">{note}</p>}
        {canEdit && (
          <div className="actions">
            <button disabled={busy}>{busy ? 'Saving…' : added ? 'Save changes' : 'Add car'}</button>
            {added && !confirmRemove && <button type="button" className="link" onClick={() => setConfirmRemove(true)}>Remove car</button>}
            {confirmRemove && <span className="confirm">Remove this car? <button type="button" className="danger small" onClick={remove}>Remove</button> <button type="button" className="link" onClick={() => setConfirmRemove(false)}>Keep it</button></span>}
          </div>
        )}
        {added && car.source !== 'form' && <p className="muted small">Fields you change here are kept when your website is pulled again.</p>}
      </form>
      {added && <Photos dealerId={dealerId} car={car} canEdit={canEdit} onChange={() => load(car.id)} />}
      {added && canOrder && <OrderForm dealerId={dealerId} car={car} onOrdered={() => onSaved(car.id)} />}
    </section>
  );
}

export function Cars({ dealerId, role }) {
  const canEdit = ['staff', 'owner', 'admin', 'approver'].includes(role);
  const canOrder = ['staff', 'owner', 'admin'].includes(role);
  const [cars, setCars] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);   // a car id, 'new', or null for the list
  const load = useCallback(() => api('GET', `/api/dealers/${dealerId}/vehicles`).then((d) => { setCars(d.vehicles); setError(''); }, (e) => setError(e.message)), [dealerId]);
  useEffect(() => { load(); setOpen(null); }, [load]);

  if (open !== null) {
    return <CarEditor key={open} dealerId={dealerId} carId={open} canEdit={canEdit} canOrder={canOrder} onClose={() => { setOpen(null); load(); }} onSaved={() => load()} />;
  }
  return (
    <section className="card">
      <div className="row">
        <h2>Cars {cars && <span className="muted small">{cars.length}</span>}</h2>
        {canEdit && <button onClick={() => setOpen('new')}>Add a car</button>}
      </div>
      <Pull dealerId={dealerId} canEdit={canEdit} onCars={load} />
      {error && <p className="error">{error}</p>}
      {cars === null ? <p className="muted">Loading…</p> : cars.length === 0 ? <p className="muted">No cars yet. Add one, or pull them from your website.</p> : (
        <div className="car-list">
          {cars.map((v) => (
            <button key={v.id} className="car" onClick={() => setOpen(v.id)}>
              {v.photo ? <img src={v.photo.thumb} alt="" loading="lazy" /> : <span className="no-photo">No photo</span>}
              <span className="car-text">
                <strong>{carTitle(v)}</strong>
                <span className="muted small">{[dollars(v.price), miles(v.mileage), v.stock_no && `stock ${v.stock_no}`].filter(Boolean).join(' · ')}</span>
                <span className="badges">
                  {v.order_status && <StatusPill status={v.order_status} />}
                  {v.missing_since && <span className="pill warn">Not on your website anymore</span>}
                  {v.photo_count === 0 && <span className="pill">No photos</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
