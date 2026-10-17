let chosen = null, busy = false;
const $ = id => document.getElementById(id);

// ---- Status messages ------------------------------------------------------------------------
// Each section has its own status line placed just above the button that triggers it. A message
// goes to the status line of the section the person last interacted with.
let statusTarget = null;
function nearestStatus(node) {
  for (let n = node; n && n !== document.body; n = n.parentElement) {
    const s = n.querySelector?.(':scope > .status');
    if (s) return s;
  }
  return null;
}
['click', 'change', 'submit'].forEach(type => document.addEventListener(type, e => {
  const s = nearestStatus(e.target);
  if (s) statusTarget = s;
}, true));
function message(text, target, isError = false) {
  const s = target || statusTarget || document.querySelector('#stepVehicle > .status');
  s.textContent = text || '';
  s.hidden = !text;
  s.classList.toggle('error', isError);
}
const fail = (text, target) => message(text, target, true);
const statusOf = id => document.querySelector(`#${id} > .status`) || $(id).querySelector('.status');

// ---- Helpers --------------------------------------------------------------------------------
async function responseJson(r) {
  const raw = await r.text(); let d;
  try { d = JSON.parse(raw); } catch { throw Error('Server returned HTTP ' + r.status + ' without valid JSON. Check config.php syntax and the PHP error log.'); }
  if (!r.ok) throw Error(d.error || 'Request failed (HTTP ' + r.status + ')');
  return d;
}
async function api(action, data = {}) {
  const r = await fetch('?api=' + action, {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': window.CSRF}, body: JSON.stringify(data)});
  return responseJson(r);
}
function el(tag, text) { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
function link(text, href) { const a = el('a', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function price(v) { return v.price == null ? 'Call for price' : new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(v.price); }
/** Every delete goes through one confirmation. */
function confirmDelete(what, detail) { return confirm(`Delete ${what}?\n\n${detail}\n\nThis cannot be undone.`); }
function dangerButton(label, onConfirm, what, detail) {
  const b = el('button', label); b.type = 'button'; b.className = 'secondary danger small';
  b.onclick = () => { if (confirmDelete(what, detail)) onConfirm(b); };
  return b;
}

// ---- Step 1: vehicles ------------------------------------------------------------------------
function render(list) {
  $('inventory').replaceChildren();
  const hidden = list.filter(v => v.active === false).length;
  if (hidden) $('inventory').append(el('small', hidden + ' vehicle' + (hidden > 1 ? 's' : '') + ' no longer in DealerCenter hidden; their videos are kept.'));
  for (const v of list.filter(v => v.active !== false)) {
    const b = el('button'); b.className = 'vehicle'; b.dataset.stock = v.StockNumber;
    const p = el('span', price(v)); p.className = 'price';
    b.append(p, el('strong', `${v.Year} ${v.Make} ${v.Model}`), el('small', `${v.Trim} · ${(v.Odometer == null ? 'Mileage not entered' : Number(v.Odometer).toLocaleString())} miles · #${v.StockNumber}`));
    b.onclick = () => select(v.StockNumber, b);
    if (chosen && chosen.StockNumber === v.StockNumber) b.classList.add('active');
    $('inventory').append(b);
  }
}
async function select(stock, button) {
  if (busy) return; busy = true;
  message('Reading vehicle details and checking its highest listed price…');
  try {
    chosen = await api('detail', {stock});
    document.querySelectorAll('.vehicle').forEach(n => n.classList.remove('active')); button.classList.add('active');
    $('selected').textContent = `${chosen.Year} ${chosen.Make} ${chosen.Model}`;
    $('facts').textContent = `${chosen.Trim} · ${price(chosen)} · ${(chosen.Odometer == null ? 'Mileage not entered' : Number(chosen.Odometer).toLocaleString())} miles · #${chosen.StockNumber}`;
    $('description').textContent = chosen.description || 'No description found.';
    $('script').value = chosen.scripts?.[$('duration').value] || chosen.script;
    $('generate').disabled = false; $('brief').disabled = false; $('buildFootage').disabled = false; $('approve').checked = false; $('confirmCurrent').checked = false;
    showPhotos(); words(); approvedVoices();
    if (typeof refreshNarrations === 'function') refreshNarrations().catch(e => fail(e.message, statusOf('voiceStudio')));
    message(chosen.sheet_error || `${chosen.Year} ${chosen.Make} ${chosen.Model} selected. Continue with the script in step 2.`);
    summary();
  } catch (e) { fail(e.message); } finally { busy = false; }
}
$('sync').onclick = async () => {
  if (busy) return; busy = true; $('sync').disabled = true;
  message('Refreshing current inventory…');
  try {
    const a = await api('sync'); render(a.vehicles); chosen = null; $('generate').disabled = true; $('brief').disabled = true; $('buildFootage').disabled = true;
    const active = a.vehicles.filter(v => v.active !== false).length, r = a.report;
    $('syncTime').textContent = `${active} vehicles · checked ${new Date(a.checked_at).toLocaleString()}`;
    message(r ? `Imported from the website: ${r.added} new, ${r.updated} updated, ${r.gone} no longer listed${r.errors.length ? `, ${r.errors.length} page(s) could not be read` : ''}. Select a vehicle.`
      : 'Inventory refreshed. Select a vehicle.', null, !!r?.errors.length); summary();
  } catch (e) { fail(e.message); } finally { busy = false; $('sync').disabled = false; }
};
const syncSections = [['added', 'Added'], ['removed', 'Removed — no longer in DealerCenter (hidden, videos kept)'], ['returned', 'Back in inventory'], ['price_changed', 'Price changed — review the script'], ['photos_updated', 'Photos updated — asset sheet rebuilt'], ['sheet_views', 'Asset sheet views changed'], ['waiting_photos', 'Waiting for photos'], ['updated', 'Details updated'], ['sheet_errors', 'Asset sheet problems']];
async function syncLog() {
  try {
    const log = await api('sync_log'), last = log.entries[0], box = $('syncLog'); box.replaceChildren();
    if (!last) return;
    let changes = 0;
    for (const [key, label] of syncSections) {
      const items = last[key] || []; if (!items.length) continue; changes += items.length;
      box.append(el('strong', label + ' (' + items.length + ')')); const ul = el('ul'); for (const s of items) ul.append(el('li', s)); box.append(ul);
    }
    if (!changes) box.append(el('p', 'No changes since the previous sync.'));
    $('syncLogSummary').textContent = `Inventory changes — DealerCenter synced ${new Date(last.at).toLocaleString()} · ${last.active_count} active · ${changes} change${changes === 1 ? '' : 's'}`;
  } catch (e) { fail(e.message, statusOf('stepVehicle')); }
}

// ---- Step 2: script ---------------------------------------------------------------------------
let speechTimer;
function words() {
  const n = $('script').value.trim().split(/\s+/).filter(Boolean).length;
  $('wordCount').textContent = n + ' written words · checking spoken length…';
  clearTimeout(speechTimer);
  speechTimer = setTimeout(async () => {
    const value = $('script').value;
    try {
      const d = await api('speech', {script: value});
      if ($('script').value === value) {
        const limit = $('duration').value === '30' ? 62 : 38;
        $('wordCount').textContent = `${d.words} spoken words · aim for ${$('duration').value === '30' ? '55–60' : 'up to 38'} for ${$('duration').value} seconds` + (d.words > limit ? ' — too long, shorten it' : '');
        $('wordCount').classList.toggle('error', d.words > limit);
        $('speechPreview').textContent = d.speech;
      }
    } catch (e) { fail(e.message, statusOf('stepVehicle')); }
  }, 250);
}
$('script').oninput = () => { words(); summary(); };
// Swap to the default script for the chosen length unless the user has edited it.
function defaultScript() {
  if (!chosen?.scripts) return;
  const v = $('script').value.trim();
  if (v === '' || Object.values(chosen.scripts).includes(v)) $('script').value = chosen.scripts[$('duration').value] || chosen.script;
}
$('duration').onchange = () => { defaultScript(); words(); approvedVoices(); summary(); };

// ---- Step 3: voice ----------------------------------------------------------------------------
async function approvedVoices() {
  const s = $('approvedVoice'), keep = s.value; s.replaceChildren();
  const add = (text, value) => { const o = el('option', text); o.value = value; s.append(o); };
  if (!chosen) { add('Choose a vehicle first', ''); summary(); return; }
  try {
    const r = await api('narration_list');
    const list = r.previews.filter(p => p.approved && p.status === 'ready' && p.stock === chosen.StockNumber && String(p.duration) === $('duration').value);
    add(list.length ? 'Choose an approved preview' : `No approved ${$('duration').value}-second preview for this car yet — make one above`, '');
    for (const p of list) add(`${p.duration}s · ${(p.text || '').slice(0, 70)}… · ${p.id.slice(0, 8)}`, p.id);
    if (list.some(p => p.id === keep)) s.value = keep; else if (list.length) s.value = list[0].id;
  } catch (e) { fail(e.message, statusOf('voiceStudio')); }
  summary();
}
$('approvedVoice').onchange = summary;
function recipe() {
  const mode = $('voice').value, eleven = mode === 'elevenlabs', narration = mode === 'narration';
  $('approvedVoiceLabel').hidden = !eleven;
  $('elevenHint').hidden = !eleven; $('voiceHint').hidden = mode !== 'native'; $('narrationHint').hidden = !narration;
  $('voiceStudio').hidden = mode === 'native';
  if (!narration && $('style').value !== 'showroom') $('style').value = 'showroom';
  $('style').querySelector('option[value="dynamic"]').disabled = !narration;
  $('scriptLabel').textContent = narration ? 'Script — copied to the ElevenLabs voice; the video itself is silent' : 'Script — the spokesperson says this in the video';
  const dynamic = $('style').value === 'dynamic';
  if (dynamic) { $('duration').value = '15'; $('duration').disabled = true; } else $('duration').disabled = false;
  const b = $('beats'); b.replaceChildren();
  const beats = dynamic ? [['00–04', 'Low tracking hook'], ['04–09', 'Interior macro glide'], ['09–15', 'Drone pull-away + offer']]
    : narration ? [['Rear corner', 'Starts walking'], ['Near side', 'Walks and presents'], ['Front corner', 'Offer + test drive']]
    : [['Shot 1', 'Front corner, wide'], ['Shot 2', 'Side, walking'], ['Shot 3', 'Rear corner'], ['Shot 4', 'Front, price + call to action']];
  b.style.gridTemplateColumns = `repeat(${beats.length},1fr)`;
  for (const [t, d] of beats) { const n = el('div'); n.append(el('b', t), el('span', d)); b.append(n); }
  defaultScript(); words(); summary();
}
$('style').onchange = recipe; $('voice').onchange = recipe;

// ---- Step 4: look -----------------------------------------------------------------------------
// Video source: AI showroom video (Seedance), or the dealer's own footage + the approved voice (no generation).
function footageMode() { return $('source').value === 'footage'; }
function sourceMode() {
  const f = footageMode();
  $('footageBox').hidden = !f; $('aiLook').hidden = f; $('aiSheet').hidden = f; $('approveLabel').hidden = f;
  for (const id of ['generate', 'checkReferences', 'brief']) $(id).hidden = f;
  $('buildFootage').hidden = !f;
  // Footage always uses the approved ElevenLabs voice from step 3.
  if (f && $('voice').value !== 'elevenlabs') { $('voice').value = 'elevenlabs'; recipe(); }
  $('voice').disabled = f;
  summary();
}
$('source').onchange = sourceMode;
$('format').onchange = () => {
  $('formatHint').textContent = $('format').value === 'facebook_feed' ? 'Seedance renders a 3:4 video; it is cropped to 4:5 when finished.' : 'Generated in this shape directly. Check captions and face placement before posting.';
  summary();
};
let spokespersons = {items: [], default: null};
const presenter = () => spokespersons.items.find(s => s.id === $('spokesperson').value);
function showPresenter() {
  const p = presenter(), box = $('spokespersonPreview'); box.replaceChildren();
  if (p) { const img = el('img'); img.src = p.url; img.alt = p.name; box.append(img, el('p', p.description)); }
  summary();
}
function renderSpokespersons(lib) {
  const keep = $('spokesperson').value; spokespersons = lib;
  const sel = $('spokesperson'); sel.replaceChildren();
  if (!lib.items.length) { const o = el('option', 'No spokespersons yet — add one under Tools'); o.value = ''; sel.append(o); }
  for (const s of lib.items) { const o = el('option', s.name + (s.id === lib.default ? ' (default)' : '')); o.value = s.id; sel.append(o); }
  sel.value = lib.items.some(s => s.id === keep) ? keep : (lib.default || '');
  showPresenter();
  const list = $('spokespersonList'); list.replaceChildren();
  if (!lib.items.length) { $('spokespersonPanel').open = true; list.append(el('p', 'No spokespersons yet. Upload the first one below.')); }
  for (const s of lib.items) {
    const card = el('div'), img = el('img'), text = el('div'); card.className = 'spokesperson-card';
    img.src = s.url; img.alt = s.name; img.loading = 'lazy';
    text.append(el('strong', s.name + (s.id === lib.default ? ' · default' : '')), el('small', s.description));
    const actions = el('div'); actions.className = 'actions';
    const d = el('button', 'Make default'); d.className = 'secondary small'; d.disabled = s.id === lib.default;
    d.onclick = () => spokespersonAction('spokesperson_default', s, 'Default spokesperson set.');
    actions.append(d, dangerButton('Delete', () => spokespersonAction('spokesperson_delete', s, 'Spokesperson deleted.'),
      `spokesperson “${s.name}”`, 'Its uploaded image is removed from the server. Videos already made are not affected.'));
    text.append(actions); card.append(img, text); list.append(card);
  }
}
async function spokespersonAction(action, s, done) {
  const target = statusOf('spokespersonForm');
  try { renderSpokespersons(await api(action, {id: s.id})); message(done, target); } catch (e) { fail(e.message, target); }
}
$('spokesperson').onchange = showPresenter;
$('manageSpokespersons').onclick = () => { $('spokespersonPanel').open = true; $('spokespersonPanel').scrollIntoView({behavior: 'smooth'}); };
$('spokespersonForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true; $('spokespersonButton').disabled = true;
  message('Uploading spokesperson image…');
  try {
    const r = await fetch('?api=spokesperson_upload', {method: 'POST', headers: {'X-CSRF-Token': window.CSRF}, body: new FormData($('spokespersonForm'))});
    const lib = await responseJson(r), added = lib.items[lib.items.length - 1];
    renderSpokespersons(lib); if (added) $('spokesperson').value = added.id; showPresenter(); $('spokespersonForm').reset();
    message('Spokesperson uploaded and selected for the next video.');
  } catch (e) { fail(e.message); } finally { busy = false; $('spokespersonButton').disabled = false; }
};
function showSheet(sheet) {
  chosen.asset_sheet = sheet; $('sheet').value = sheet.url; $('sheetPreview').replaceChildren();
  const img = el('img'); img.src = sheet.url; img.alt = 'Vehicle reference sheet assembled from original inventory photos'; img.className = 'asset-preview';
  $('sheetPreview').append(img, el('p', sheet.photo_count + ' source photos · original appearance preserved'));
}
function showPhotos() {
  const picker = $('photoPicker'); picker.replaceChildren(); $('sheetPreview').replaceChildren(); $('sheet').value = '';
  if (chosen.asset_sheet) showSheet(chosen.asset_sheet);
  const picked = chosen.asset_sheet?.photo_urls || [];
  for (const [i, url] of chosen.photos.entries()) {
    const label = el('label'), c = el('input'), img = el('img');
    c.type = 'checkbox'; c.value = url; c.checked = picked.includes(url); img.src = url; img.loading = 'lazy'; img.alt = 'Inventory photo ' + (i + 1);
    label.append(c, img, el('small', 'Photo ' + (i + 1))); picker.append(label);
  }
  $('rebuild').disabled = false;
}
$('rebuild').onclick = async () => {
  if (busy || !chosen) return;
  const photos = [...$('photoPicker').querySelectorAll('input:checked')].map(n => n.value);
  if (photos.length < 1 || photos.length > 9) { fail('Select 1–9 photos.'); return; }
  busy = true; $('rebuild').disabled = true; message('Creating asset sheet from the selected photos…');
  try { showSheet(await api('sheet', {stock: chosen.StockNumber, photos})); message('Asset sheet ready.'); }
  catch (e) { fail(e.message); } finally { busy = false; $('rebuild').disabled = false; }
};

// ---- Step 5: generate -------------------------------------------------------------------------
function summary() {
  const ul = $('summary'); if (!ul) return; ul.replaceChildren();
  const voiceText = {elevenlabs: 'approved ElevenLabs voice', native: 'Seedance voice', narration: 'silent video + ElevenLabs lip-sync'}[$('voice').value];
  const approved = $('voice').value !== 'elevenlabs' || $('approvedVoice').value;
  const footage = footageMode();
  const rows = [
    ['Vehicle', chosen ? `${chosen.Year} ${chosen.Make} ${chosen.Model} · ${price(chosen)}` : 'not selected', !!chosen],
    ['Voice', voiceText + ($('voice').value === 'elevenlabs' ? (approved ? ' · preview chosen' : ' · no approved preview yet') : ''), !!approved],
    footage ? ['Footage', $('footage').files[0]?.name || 'no video chosen yet', !!$('footage').files[0]] : ['Spokesperson', presenter()?.name || 'none', !!presenter()],
    ['Video', `${$('duration').value} s · ${$('format').selectedOptions[0]?.text.split(' — ')[0]} · ${footage ? 'your footage' : $('style').value === 'showroom' ? 'walkaround' : 'dynamic'}`, true],
  ];
  for (const [k, v, ok] of rows) { const li = el('li'); li.className = ok ? 'ok' : 'todo'; li.append(el('b', k), el('span', v)); ul.append(li); }
}
function brief() {
  return {vehicle: chosen, format: $('format').value, duration: Number($('duration').value), style: $('style').value, voice: $('voice').value, script: $('script').value,
    reference_images: {car_asset_sheet: $('sheet').value, spokesperson: presenter()?.url || ''}, spokesperson: presenter()?.name || '', avatar_profile: presenter()?.description || '', model: 'Seedance 2.5',
    shots: $('style').value === 'showroom' ? [{shot: 1, direction: 'Wide front three-quarter; spokesperson beside the front fender'}, {shot: 2, direction: 'Wide side profile; she walks along the side'}, {shot: 3, direction: 'Wide rear three-quarter; she stands at the rear corner'}, {shot: 4, direction: 'Wide front from the other side; price and call to action'}]
      : [{seconds: '0–4', direction: 'Ultra-low stabilized tracking'}, {seconds: '4–9', direction: 'Interior macro glide'}, {seconds: '9–15', direction: 'Drone dolly-out plus offer'}],
    finishing: 'Captions burned in as white text on black boxes; whole car in frame in every shot.'};
}
$('brief').onclick = () => {
  const blob = new Blob([JSON.stringify(brief(), null, 2)], {type: 'application/json'}), u = URL.createObjectURL(blob), a = el('a');
  a.href = u; a.download = `golden-auto-${chosen.StockNumber}-brief.json`; a.click(); URL.revokeObjectURL(u);
};
$('generate').onclick = async () => {
  if (busy || !chosen) return;
  if ($('voice').value === 'elevenlabs' && !$('approvedVoice').value) { fail('Choose an approved voice preview in step 3 first.'); return; }
  busy = true; $('generate').disabled = true;
  message('Checking current availability and submitting one paid generation…');
  try {
    await api('generate', {stock: chosen.StockNumber, format: $('format').value, style: $('style').value, voice: $('voice').value, narration_id: $('approvedVoice').value,
      duration: Number($('duration').value), script: $('script').value, sheet: $('sheet').value, spokesperson: $('spokesperson').value,
      approve_spend: $('approve').checked, confirm_current: $('confirmCurrent').checked});
    $('approve').checked = false;
    message('Generation submitted. It takes a few minutes — follow it under Videos below.');
    await jobs(); $('videos').scrollIntoView({behavior: 'smooth'});
  } catch (e) { fail(e.message); } finally { busy = false; $('generate').disabled = !chosen; }
};
$('footage').onchange = summary;
$('buildFootage').onclick = async () => {
  if (busy || !chosen) return;
  if (!$('approvedVoice').value) { fail('Choose an approved voice preview in step 3 first.'); return; }
  const file = $('footage').files[0];
  if (!file) { fail('Choose the car video in step 4 first.'); return; }
  if (file.size > 64 * 1024 * 1024) { fail('That video is larger than 64 MB. Export or film it at 1080p.'); return; }
  busy = true; $('buildFootage').disabled = true;
  message('Uploading your footage… this can take a minute on a slow connection.');
  try {
    const form = new FormData();
    form.append('stock', chosen.StockNumber); form.append('format', $('format').value); form.append('narration_id', $('approvedVoice').value);
    if ($('confirmCurrent').checked) form.append('confirm_current', '1');
    form.append('footage', file);
    const r = await fetch('?api=footage_build', {method: 'POST', headers: {'X-CSRF-Token': window.CSRF}, body: form});
    message((await responseJson(r)).message);
    await jobs(); $('videos').scrollIntoView({behavior: 'smooth'});
  } catch (e) { fail(e.message); } finally { busy = false; $('buildFootage').disabled = !chosen; }
};
$('checkReferences').onclick = async () => {
  if (busy) return; busy = true; $('checkReferences').disabled = true;
  message('Uploading reference images to Higgsfield storage; no video is generated…');
  try { message((await api('references', {sheet: $('sheet').value, spokesperson: $('spokesperson').value})).message); }
  catch (e) { fail(e.message); } finally { busy = false; $('checkReferences').disabled = false; }
};

// ---- Videos -----------------------------------------------------------------------------------
const GENERATING = ['preparing_references', 'submitting', 'queued', 'in_progress'];
function stage(j) {
  if (GENERATING.includes(j.status)) return ['Generating at Higgsfield…', 'busy'];
  if (j.status === 'completed') {
    if (['queued', 'rendering'].includes(j.finish_status)) return ['Adding captions…', 'busy'];
    if (j.finish_status === 'completed') return ['Ready', 'ok'];
    if (j.finish_status === 'failed') return ['Captioning failed', 'bad'];
    return [j.auto_build ? 'Generated — preparing captions' : 'Generated — add captions', 'busy'];
  }
  if (j.status === 'submission_uncertain') return ['Submission not confirmed — check Higgsfield history before retrying', 'bad'];
  return [j.status === 'failed' ? 'Failed' : j.status, j.status === 'failed' ? 'bad' : ''];
}
let jobsTimer;
async function jobs() {
  const target = statusOf('videos');
  try {
    const rows = (await api('jobs')).map(r => JSON.parse(r)); $('jobs').replaceChildren();
    if (!rows.length) $('jobs').append(el('p', 'No videos yet. Generate one in step 5.'));
    let active = false;
    for (const j of rows) {
      const [label, tone] = stage(j); if (tone === 'busy') active = true;
      const box = el('div'); box.className = 'job';
      const head = el('div'); head.className = 'job-head';
      const badge = el('span', label); badge.className = 'badge ' + tone;
      head.append(el('strong', j.vehicle), badge);
      const voice = {elevenlabs: 'approved voice', native: 'Seedance voice', narration: 'lip-sync'}[j.voice] || '';
      box.append(head, el('small', [j.spokesperson, j.format?.replace('_', ' '), j.duration ? j.duration + ' s' : '', voice, j.created_at ? new Date(j.created_at).toLocaleString() : ''].filter(Boolean).join(' · ')));
      if (j.error) box.append(el('p', j.error)); if (j.finish_error) box.append(el('p', j.finish_error));
      const actions = el('div'); actions.className = 'actions';
      if (j.captioned_url?.startsWith('https://')) { const a = link('Download final video', j.captioned_url); a.className = 'button'; actions.append(a); }
      if (j.video_url?.startsWith('https://')) actions.append(link('Open uncaptioned master', j.video_url));
      if (j.request_id && j.status !== 'completed') {
        const b = el('button', 'Check status'); b.className = 'secondary small';
        b.onclick = async () => { b.disabled = true; try { await api('poll', {id: j.id}); await jobs(); message('Status updated.', target); } catch (e) { fail(e.message, target); b.disabled = false; } };
        actions.append(b);
      }
      if (j.status === 'completed' && !['queued', 'rendering'].includes(j.finish_status)) {
        const c = el('button', j.finish_status === 'completed' ? 'Edit captions' : 'Add captions'); c.className = 'secondary small'; c.onclick = () => editCaptions(j.id); actions.append(c);
      }
      if (!GENERATING.includes(j.status) && j.finish_status !== 'rendering') actions.append(dangerButton('Delete video', async b => {
        b.disabled = true;
        try { message((await api('job_delete', {id: j.id})).message, target); await jobs(); } catch (e) { fail(e.message, target); b.disabled = false; }
      }, `this video for ${j.vehicle}`, 'The job and its captioned file are removed from the dashboard. The original stays in your Higgsfield history.'));
      box.append(actions); $('jobs').append(box);
    }
    clearTimeout(jobsTimer);
    if (active) jobsTimer = setTimeout(() => jobs(), 30000);
  } catch (e) { fail(e.message, target); }
}
$('refreshJobs').onclick = async () => { await jobs(); message('List refreshed.'); };
let captionJob = null;
async function editCaptions(id) {
  const target = statusOf('captionEditor');
  try {
    const r = await api('caption_draft', {id}); captionJob = id; $('captionSrt').value = r.srt; $('captionReviewed').checked = false;
    $('captionEditor').hidden = false; $('captionEditor').scrollIntoView({behavior: 'smooth'}); message(r.note, target);
  } catch (e) { fail(e.message, statusOf('videos')); }
}
$('renderCaptions').onclick = async () => {
  if (!captionJob) return; $('renderCaptions').disabled = true;
  try { message((await api('finish', {id: captionJob, srt: $('captionSrt').value, reviewed: $('captionReviewed').checked})).message); await jobs(); }
  catch (e) { fail(e.message); } finally { $('renderCaptions').disabled = false; }
};
$('closeCaptions').onclick = () => { $('captionEditor').hidden = true; captionJob = null; };

// ---- Tools ------------------------------------------------------------------------------------
$('importForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true; $('importButton').disabled = true;
  message('Importing DealerCenter photos and creating the asset sheet…');
  try {
    const r = await fetch('?api=import', {method: 'POST', headers: {'X-CSRF-Token': window.CSRF}, body: new FormData($('importForm'))});
    const d = await responseJson(r); render(d.vehicles);
    message('Imported ' + d.imported.photos.length + ' photos for stock ' + d.imported.StockNumber + '. Select it in step 1.');
  } catch (e) { fail(e.message); } finally { busy = false; $('importButton').disabled = false; }
};
$('logout').onclick = async () => { await api('logout'); location.reload(); };

// ---- Clients ----------------------------------------------------------------------------------
// Each client (dealer) has its own inventory, voice previews and videos. Golden Auto is the first one.
let clientList = {items: [], current: null};
const METHOD_TITLE = {feed: 'Daily inventory feed', website_dealercenter: 'Website reader', website_structured: 'Website import',
  browser_snapshot: 'Browser snapshot', zip: 'Manual import', dealercenter_snapshot: 'DealerCenter website snapshot'};
function showClient() {
  const c = clientList.items.find(x => x.id === clientList.current); if (!c) return;
  document.querySelector('header .eyebrow').textContent = c.name.toUpperCase();
  const a = c.analysis || {}, box = $('clientAnalysis'); box.replaceChildren();
  $('clientSummary').textContent = `${c.name} · ${c.website.replace('https://', '')} · import: ${METHOD_TITLE[a.best] || 'not checked yet'}`;
  if (a.note) box.append(el('p', a.note));
  if (a.platform) box.append(el('p', 'Website platform: ' + a.platform));
  if (a.dealer) box.append(el('p', 'Dealer details found: ' + Object.values(a.dealer).join(', ')));
  if (a.signals?.length) { const ul = el('ul'); for (const sig of a.signals) ul.append(el('li', sig)); box.append(el('b', 'What the website shows'), ul); }
  if (a.options?.length) {
    const ol = el('ol'); box.append(el('b', 'Import options, best first'));
    for (const o of a.options) { const li = el('li'); li.append(el('strong', o.title), el('p', o.why), el('small', o.effort)); ol.append(li); }
    box.append(ol);
  }
  if (a.checked_at) box.append(el('small', 'Checked ' + new Date(a.checked_at).toLocaleString()));
  $('clientAnalyze').hidden = c.id === 'golden-auto';
  // DealerCenter sync log and website refresh are Golden Auto's.
  $('syncLogPanel').hidden = c.id !== 'golden-auto';
  // Website refresh: Golden Auto's reader, or a client whose site the importer supports (Dealer Car Search).
  $('sync').hidden = !(c.id === 'golden-auto' || (a.platform === 'Dealer Car Search' && a.reachable));
  $('sync').textContent = c.id === 'golden-auto' ? 'Refresh inventory' : 'Import inventory from website';
}
async function loadClients() {
  clientList = await api('clients');
  const sel = $('client'); sel.replaceChildren();
  for (const c of clientList.items) { const o = el('option', c.name); o.value = c.id; sel.append(o); }
  sel.value = clientList.current; showClient();
}
$('client').onchange = async () => {
  try { await api('client_select', {id: $('client').value}); location.reload(); } catch (e) { fail(e.message, statusOf('stepVehicle')); }
};
$('addClientToggle').onclick = () => { $('clientForm').hidden = !$('clientForm').hidden; };
$('clientForm').onsubmit = async event => {
  event.preventDefault(); if (busy) return; busy = true; $('clientAdd').disabled = true;
  const f = new FormData($('clientForm'));
  message('Adding the client and analyzing its website…', statusOf('stepVehicle'));
  try { await api('client_add', {name: f.get('name'), website: f.get('website')}); location.reload(); }
  catch (e) { fail(e.message, statusOf('stepVehicle')); } finally { busy = false; $('clientAdd').disabled = false; }
};
$('clientAnalyze').onclick = async () => {
  if (busy) return; busy = true; $('clientAnalyze').disabled = true;
  message('Analyzing the website…', statusOf('stepVehicle'));
  try {
    const r = await api('client_analyze', {id: clientList.current});
    clientList.items = clientList.items.map(c => c.id === r.client.id ? r.client : c); showClient(); $('clientInfo').open = true;
    message('Website analyzed.', statusOf('stepVehicle'));
  } catch (e) { fail(e.message, statusOf('stepVehicle')); } finally { busy = false; $('clientAnalyze').disabled = false; }
};

// ---- Start --------------------------------------------------------------------------------------
recipe();
(async () => { try { renderSpokespersons(await api('spokesperson_list')); } catch (e) { fail(e.message, statusOf('stepLook')); } })();
syncLog();
loadClients().catch(e => fail(e.message, statusOf('stepVehicle')));
(async () => {
  try {
    const a = await api('inventory'); render(a.vehicles || []);
    const active = (a.vehicles || []).filter(v => v.active !== false).length;
    $('syncTime').textContent = a.dealercenter_checked_at ? `${active} vehicles · DealerCenter synced ${new Date(a.dealercenter_checked_at).toLocaleString()}`
      : a.checked_at ? `${active} vehicles · checked ${new Date(a.checked_at).toLocaleString()}` : `${active} vehicles`;
    await jobs();
  } catch (e) { fail(e.message, statusOf('stepVehicle')); }
})();
