// Step 4: video source, spokesperson, style, publish format and the car photos sent to the video model.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { useStudio } from './App.jsx';
import { Status } from './ui.jsx';

export default function LookStep() {
  const s = useStudio();
  const footage = s.source === 'footage', narration = s.voice === 'narration';
  const beats = s.style === 'dynamic' ? [['00–04', 'Low tracking hook'], ['04–09', 'Interior macro glide'], ['09–15', 'Drone pull-away + offer']]
    : narration ? [['Rear corner', 'Starts walking'], ['Near side', 'Walks and presents'], ['Front corner', 'Offer + test drive']]
      : [['Shot 1', 'Front corner, wide'], ['Shot 2', 'Side, walking'], ['Shot 3', 'Rear corner'], ['Shot 4', 'Front, price + call to action']];
  const manage = () => { s.setSpokespersonPanelOpen(true); document.getElementById('spokespersonPanel')?.scrollIntoView({ behavior: 'smooth' }); };
  return (
    <section className="panel" id="stepLook">
      <div className="step-head"><span className="step-num">4</span><div><h2>Look</h2><p>Spokesperson, style, format and the car photos the video is made from.</p></div></div>
      <label>Video source
        <select id="source" value={s.source} onChange={(e) => s.setSource(e.target.value)}>
          <option value="ai">AI showroom video — Seedance films the car and the spokesperson</option>
          <option value="footage">My footage — a video I filmed of this car (no spokesperson, no generation cost)</option>
        </select>
      </label>
      <div id="footageBox" hidden={!footage}>
        <label>Car video — MP4 or MOV, up to 64 MB
          <input type="file" id="footage" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" onChange={(e) => s.setFootage(e.target.files[0] ?? null)} />
        </label>
        <p className="hint">Hold the phone upright and walk slowly around the car for 30–45 seconds, in even light; film or export at 1080p so it stays under 64 MB. Its own sound is replaced by the approved voice from step 3, and it is cropped to the publish format and trimmed to the video length.</p>
      </div>
      <div id="aiLook" hidden={footage}>
        <label>Spokesperson
          <select id="spokesperson" value={s.spokespersonId} onChange={(e) => s.setSpokespersonId(e.target.value)}>
            {!s.spokespersons.items.length && <option value="">No spokespersons yet — add one under Tools</option>}
            {s.spokespersons.items.map((p) => <option key={p.id} value={p.id}>{p.name + (p.id === s.spokespersons.default ? ' (default)' : '')}</option>)}
          </select>
        </label>
        <div id="spokespersonPreview" className="spokesperson-preview">
          {s.spokesperson && <><img src={s.spokesperson.url} alt={s.spokesperson.name} /><p>{s.spokesperson.description}</p></>}
        </div>
        <button type="button" className="secondary small" id="manageSpokespersons" onClick={manage}>Add or manage spokespersons</button>
        <label>Video style
          <select id="style" value={s.style} onChange={(e) => s.setStyle(e.target.value)}>
            <option value="showroom">Showroom walkaround — spokesperson walks around the car</option>
            <option value="dynamic" disabled={!narration}>Dynamic product sequence — tracking / interior / drone (lip-sync method only)</option>
          </select>
        </label>
        <div className="beats" id="beats" style={{ gridTemplateColumns: `repeat(${beats.length},1fr)` }}>
          {beats.map(([t, d]) => <div key={t}><b>{t}</b><span>{d}</span></div>)}
        </div>
      </div>
      <label>Publish format
        <select id="format" value={s.format} onChange={(e) => s.setFormat(e.target.value)}>
          <option value="instagram_reels">Instagram Reels — 9:16</option>
          <option value="facebook_reels">Facebook Reels — 9:16</option>
          <option value="facebook_feed">Facebook Feed — 4:5 (cropped after generation)</option>
          <option value="square">Instagram / Facebook Square — 1:1</option>
        </select>
      </label>
      <p className="hint" id="formatHint">{s.format === 'facebook_feed' ? 'Seedance renders a 3:4 video; it is cropped to 4:5 when finished.' : 'Generated in this shape directly. Check captions and face placement before posting.'}</p>
      <div id="aiSheet" hidden={footage}><AssetSheet /></div>
    </section>
  );
}

function AssetSheet() {
  const s = useStudio();
  const [status, say] = s.statuses.sheet;
  const c = s.chosen;
  const [picked, setPicked] = useState([]);
  useEffect(() => { setPicked(c?.asset_sheet?.photo_urls ?? []); }, [c?.StockNumber, c?.asset_sheet?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const rebuild = () => {
    if (!c) return;
    const photos = c.photos.filter((u) => picked.includes(u));
    if (photos.length < 1 || photos.length > 9) { say('Select 1–9 photos.', true); return; }
    s.run(async () => {
      say('Creating asset sheet from the selected photos…');
      try {
        const sheet = await api('sheet', { stock: c.StockNumber, photos });
        s.setChosen({ ...c, asset_sheet: sheet }); s.setSheetUrl(sheet.url);
        say('Asset sheet ready.');
      } catch (e) { say(e.message, true); }
    });
  };
  const kept = c?.photo_labels ? Object.values(c.photo_labels).reduce((a, b) => a + b, 0) : 0;
  return (
    <>
      <span className="eyebrow">CAR PHOTOS SENT TO THE VIDEO MODEL</span>
      <div id="sheetPreview">
        {c?.asset_sheet && <><img src={c.asset_sheet.url} alt="Vehicle reference sheet assembled from original inventory photos" className="asset-preview" />
          <p>{c.asset_sheet.photo_count} source photos · original appearance preserved</p></>}
        {/* Website-imported cars: photos are copied and sorted in the background (exterior shots only). */}
        {c?.photos_pending && <p>{c.photos.length ? 'New photos are being imported and sorted; these are the previous ones. Reopen the car in a few minutes.'
          : 'Photos are being imported and sorted (exterior shots only). Reopen the car in a few minutes.'}</p>}
        {c && !c.photos_pending && c.photo_labels && <small>{`${c.photos.length} exterior photos kept of ${kept} on the website`}</small>}
      </div>
      <details className="sub"><summary>Change which photos are used</summary>
        <p className="hint">Default: front, both sides and rear (4 photos, 2×2). Choose up to 9 photos; avoid close-ups with text such as labels or stickers.</p>
        <div id="photoPicker" className="photo-picker">
          {(c?.photos ?? []).map((url, i) => (
            <label key={url}>
              <input type="checkbox" value={url} checked={picked.includes(url)} onChange={(e) => setPicked(e.target.checked ? [...picked, url] : picked.filter((u) => u !== url))} />
              <img src={url} loading="lazy" alt={'Inventory photo ' + (i + 1)} /><small>Photo {i + 1}</small>
            </label>
          ))}
        </div>
        <label>Optional asset sheet URL override<input id="sheet" type="url" placeholder="https://your-domain.com/car-asset-sheet.jpg" value={s.sheetUrl} onChange={(e) => s.setSheetUrl(e.target.value)} /></label>
        <Status s={status} />
        <button id="rebuild" className="secondary" disabled={!c || s.busy} onClick={rebuild}>Rebuild asset sheet</button>
      </details>
    </>
  );
}
