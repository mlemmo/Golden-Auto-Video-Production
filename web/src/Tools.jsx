// Tools: spokesperson images, DealerCenter media ZIP import, and the lip-sync builder (older two-step voice method).
import { useEffect, useRef, useState } from 'react';
import { api, upload } from './api.js';
import { useClientState, useStudio } from './App.jsx';
import { DangerButton, Link } from './ui.jsx';
import { PasswordTool, UsersTool } from './Accounts.jsx';

const TOOLS = [
  ['users', 'Manage users', 'Add accounts, set roles and which clients each person may use', 'admin'],
  ['spokespersons', 'Manage spokespersons', 'Upload new spokesperson images and manage saved ones', 'admin'],
  ['import', 'Import a vehicle (DealerCenter ZIP)', 'For cars not on the website yet'],
  ['lipsync', 'Lip-sync builder', 'Only for the “ElevenLabs narration + lip-sync” voice method'],
];

/** ☰ Tools in the top bar: a dropdown of simple buttons, each opening its tool in a full-page window. */
export function ToolsMenu() {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="secondary small" id="toolsMenu" aria-haspopup="menu" aria-expanded={open} aria-label="Tools" onClick={() => setOpen(!open)}>☰<span className="label-long"> Tools</span></button>
      {open && (
        <div className="menu-list" role="menu">
          {TOOLS.filter(([, , , only]) => !only || s.isAdmin).map(([key, label, hint]) => (
            <button key={key} type="button" role="menuitem" className="menu-item" id={'tool-' + key} onClick={() => { setOpen(false); s.setTool(key); }}>
              <strong>{label}</strong><small>{hint}</small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The open tool, filling the page (title, Close; Esc closes). All tools stay mounted while closed, so their forms
 * and the lip-sync builder's automatic status checks keep going.
 */
export function ToolWindows() {
  const s = useStudio();
  const close = () => s.setTool(null);
  useEffect(() => {
    if (!s.tool) return undefined;
    const esc = (e) => { if (e.key === 'Escape') s.setTool(null); };
    document.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = ''; };
  }, [s.tool]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = s.tool === 'account' ? 'Change password' : TOOLS.find(([key]) => key === s.tool)?.[1] ?? '';
  return (
    <div className="tool-window" id="tools" role="dialog" aria-modal="true" aria-label={title} hidden={!s.tool}>
      <div className="tool-window-head">
        <h2>{title}</h2>
        <button type="button" className="secondary" id="toolsClose" onClick={close}>Close</button>
      </div>
      <div className="tool-window-body">
        {s.isAdmin && <div hidden={s.tool !== 'users'}><UsersTool active={s.tool === 'users'} /></div>}
        <div hidden={s.tool !== 'account'}><PasswordTool /></div>
        {s.isAdmin && <div hidden={s.tool !== 'spokespersons'}><Spokespersons /></div>}
        <div hidden={s.tool !== 'import'}><ZipImport key={'zip-' + (s.clients.current ?? '')} /></div>
        <div hidden={s.tool !== 'lipsync'}><LipsyncBuilder /></div>
      </div>
    </div>
  );
}

function Spokespersons() {
  const s = useStudio();
  const [, say] = s.statuses.spokesperson;
  const formRef = useRef(null);
  const lib = s.spokespersons;
  const act = async (action, p, done) => {
    try { s.showSpokespersons(await api(action, { id: p.id })); say(done); } catch (e) { say(e.message, true); }
  };
  const submit = (e) => {
    e.preventDefault();
    s.run(async () => {
      say('Uploading spokesperson image…');
      try {
        const next = await upload('spokesperson_upload', new FormData(formRef.current)), added = next.items[next.items.length - 1];
        s.showSpokespersons(next, added?.id ?? null); formRef.current.reset();
        say('Spokesperson uploaded and selected for the next video.');
      } catch (err) { say(err.message, true); }
    });
  };
  return (
    <section className="tool-section" id="spokespersonPanel">
      <div id="spokespersonList" className="spokesperson-list">
        {!lib.items.length && <p>No spokespersons yet. Upload the first one below.</p>}
        {lib.items.map((p) => (
          <div key={p.id} className="spokesperson-card">
            <img src={p.url} alt={p.name} loading="lazy" />
            <div>
              <strong>{p.name + (p.id === lib.default ? ' · default' : '')}</strong>
              <small>{p.description}</small>
              <div className="actions">
                <button className="secondary small" disabled={p.id === lib.default} onClick={() => act('spokesperson_default', p, 'Default spokesperson set.')}>Make default</button>
                <DangerButton label="Delete" what={`spokesperson “${p.name}”`} detail="Its uploaded image is removed from the server. Videos already made are not affected."
                  onConfirm={() => act('spokesperson_delete', p, 'Spokesperson deleted.')} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <form id="spokespersonForm" ref={formRef} onSubmit={submit}>
        <div className="import-grid">
          <label>Name<input name="name" maxLength={60} required placeholder="e.g. Maya — showroom" /></label>
          <label>Image (JPG, PNG or WebP, at least 300×300)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label>
        </div>
        <label>Description used in the video prompt<textarea name="description" rows={2} maxLength={300} required placeholder="trustworthy friendly adult man age 35–40, navy blazer over open-collar shirt" /></label>
        <p className="hint">Use a clear, well-lit, front-facing photo of one person from the waist up on a plain background. Describe what the image shows (apparent age, look, outfit). <strong>Only upload people who have agreed to appear in your ads.</strong></p>
        <button id="spokespersonButton" disabled={s.busy}>Upload spokesperson</button>
      </form>
    </section>
  );
}

function ZipImport() {
  const s = useStudio();
  const [, say] = s.statuses.import;
  const formRef = useRef(null);
  const submit = (e) => {
    e.preventDefault();
    s.run(async () => {
      say('Importing DealerCenter photos and creating the asset sheet…');
      try {
        const d = await upload('import', new FormData(formRef.current));
        s.setInventory((inv) => ({ ...(inv ?? {}), vehicles: d.vehicles }));
        say('Imported ' + d.imported.photos.length + ' photos for stock ' + d.imported.StockNumber + '. Select it in step 1.');
      } catch (err) { say(err.message, true); }
    });
  };
  return (
    <section className="tool-section" id="importPanel">
      <form id="importForm" ref={formRef} onSubmit={submit}>
        <div className="import-grid">
          <label>Stock number<input name="stock" required /></label><label>Year<input name="year" type="number" required min={1900} max={2100} /></label>
          <label>Make<input name="make" required /></label><label>Model<input name="model" required /></label><label>Trim<input name="trim" /></label>
          <label>VIN (optional)<input name="vin" /></label><label>Mileage (optional)<input name="mileage" type="number" min={0} /></label>
          <label>Advertised prices (highest used)<input name="prices" placeholder="14550; 14688.25" /></label>
        </div>
        <label>Vehicle description<textarea name="description" rows={3} /></label>
        <label>DealerCenter media ZIP<input name="media" type="file" accept=".zip" required /></label>
        <p className="hint">Enter current listing facts. <strong>ZIP photos alone do not supply pricing or availability.</strong> Maximum 50 MB; your host’s upload limit may be lower.</p>
        <button id="importButton" disabled={s.busy}>Import vehicle and photos</button>
      </form>
    </section>
  );
}

const FINAL = { waiting: 'preparing captions', queued: 'queued for final render', rendering: 'rendering final video', completed: 'final video ready', failed: 'final build failed' };

function LipsyncBuilder() {
  const s = useStudio();
  const [, say] = s.statuses.builder;
  const [narrationId, setNarrationId] = useClientState('lipsync.narration', '');
  const [videoId, setVideoId] = useClientState('lipsync.video', '');
  const [current, setCurrent] = useState(false);
  const [spend, setSpend] = useState(false);
  const [pending, setPending] = useState(false);
  // Confirmation and paid-approval boxes never carry over to another client.
  useEffect(() => { setCurrent(false); setSpend(false); }, [s.clients.current]);
  const r = s.narr;
  const approved = r.previews.filter((p) => p.status === 'ready' && p.audio_url && !p.too_long && p.approved);
  async function act(action, data) {
    if (pending) return;
    setPending(true);
    try { const out = await api(action, data); if (out.message) say(out.message); await s.refreshNarrations(); }
    catch (e) { say(e.message, true); } finally { setPending(false); }
  }
  // Lip-sync jobs building automatically: refresh the lists every 30 seconds.
  const building = r.lipsync.some((j) => j.auto_build && (['submitting', 'queued', 'in_progress', 'unknown'].includes(j.status) || (j.final && ['waiting', 'queued', 'rendering'].includes(j.final.status))));
  useEffect(() => {
    if (!building) return undefined;
    const t = setTimeout(() => { s.refreshNarrations().then(() => s.loadJobs()).catch((e) => say(e.message, true)); }, 30000);
    return () => clearTimeout(t);
  }, [r, building]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () => {
    act('narration_lipsync', { narration_id: narrationId, video_id: videoId, approve_spend: spend, confirm_current: current, auto_build: true });
    setSpend(false);
  };
  return (
    <section className="tool-section" id="lipsyncPanel">
      <p className="hint">Choose an approved voice preview and a completed silent video of the same car, price and length, then approve once. Lip-sync runs, captions are timed from the narration and the final video is rendered automatically. Shorter narration is padded with silence; longer narration must be revised.</p>
      <label>Approved voice preview
        <select id="nApproved" value={narrationId} onChange={(e) => setNarrationId(e.target.value)}>
          <option value="">Choose an approved preview</option>
          {approved.map((p) => <option key={p.id} value={p.id}>{`${p.vehicle} · ${p.duration}s · ${p.id.slice(0, 8)}`}</option>)}
        </select>
      </label>
      <label>Completed source video
        <select id="nVideo" value={videoId} onChange={(e) => setVideoId(e.target.value)}>
          <option value="">Choose a completed video</option>
          {r.videos.map((v) => <option key={v.id} value={v.id}>{`${v.vehicle} · ${v.duration}s · ${v.id.slice(0, 8)}`}</option>)}
        </select>
      </label>
      <label className="check note-important"><input type="checkbox" id="nCurrent" checked={current} onChange={(e) => setCurrent(e.target.checked)} />I confirm this vehicle is <b>available</b> and the advertised <b>price is current</b>.</label>
      <label className="check note-important"><input type="checkbox" id="nSyncSpend" checked={spend} onChange={(e) => setSpend(e.target.checked)} />I approve <b>one paid fal Sync Lipsync request</b> at my account’s current rate; captions and the final render then run automatically.</label>
      <button type="button" id="nSubmitSync" disabled={pending || !current || !spend} title={current && spend ? undefined : 'Tick both boxes above first'} onClick={submit}>Build final video with lip-sync</button>
      <div id="nSyncJobs" className="list">
        {r.lipsync.map((job) => {
          const auto = job.auto_build && (['submitting', 'queued', 'in_progress', 'unknown'].includes(job.status) || (job.final && ['waiting', 'queued', 'rendering'].includes(job.final.status)));
          return (
            <div key={job.id} className="job">
              <strong>{job.vehicle}</strong>
              <span>{'Lip-sync: ' + job.status + (job.final ? ' · ' + (FINAL[job.final.status] || job.final.status) : '')}</span>
              {auto && <small>Building automatically — this list refreshes every 30 seconds.</small>}
              {job.final?.error && <p>{job.final.error}</p>}
              {job.error && <p>{job.error}</p>}
              {job.status === 'submission_uncertain' && <p>Check fal request history before any retry.</p>}
              <div className="actions">
                {job.final?.url?.startsWith('https://') && <Link href={job.final.url}>Download final video</Link>}
                {job.request_id && !['completed', 'failed'].includes(job.status) && (
                  <button type="button" className="secondary small" onClick={async () => { await act('narration_poll', { id: job.id }); await s.loadJobs(); }}>Check lip-sync status</button>
                )}
                {job.video_url?.startsWith('https://') && <Link href={job.video_url}>Open video with approved narration</Link>}
                {!['submitting', 'queued', 'in_progress'].includes(job.status) && (
                  <DangerButton label="Delete lip-sync job" what={`this lip-sync job for ${job.vehicle}`} detail={job.status === 'completed' ? 'The finished video stays under Videos.' : 'Nothing else is affected.'}
                    onConfirm={() => act('narration_lipsync_delete', { id: job.id })} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
