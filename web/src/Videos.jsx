// Videos: every generation and footage build for the current client, newest first, refreshed every 30 seconds while
// one is being made; plus the caption editor (review or correct the captions and render again, free).
import { useState } from 'react';
import { api } from './api.js';
import { GENERATING, StepHead, useStudio, Editable } from './App.jsx';
import { DangerButton, LatestFirst, Link, newestFirst } from './ui.jsx';

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
const VOICE = { elevenlabs: 'approved voice', native: 'Seedance voice', narration: 'lip-sync' };

export default function Videos() {
  const s = useStudio();
  const [, say] = s.statuses.videos;
  const [, sayCaptions] = s.statuses.captions;
  const [draft, setDraft] = useState({ srt: '', reviewed: false });

  const openCaptions = async (id) => {
    try {
      const r = await api('caption_draft', { id });
      s.setCaptionJob(id); setDraft({ srt: r.srt, reviewed: false }); sayCaptions(r.note);
      setTimeout(() => document.getElementById('captionEditor')?.scrollIntoView({ behavior: 'smooth' }), 0);
    } catch (e) { say(e.message, true); }
  };
  // Only the selected vehicle's videos (every finished video is in the Library).
  const stock = s.chosen?.StockNumber ?? null;
  const rows = stock === null ? [] : newestFirst((s.jobs ?? []).filter((j) => String(j.stock ?? '') === String(stock)));
  return (
    <section className={s.stepClass('videos')} id="videos">
      <StepHead id="videos" num="✓" title={<h2>Videos</h2>} sub={<p>Generation takes a few minutes; this list refreshes itself while a video is being made. Download finished videos promptly.</p>} />
      <Editable>
      <div className="actions"><button type="button" className="secondary" id="refreshJobs" onClick={async () => { await s.loadJobs(); say('List refreshed.'); }}>Refresh list</button></div>
      <div id="jobs" className="list">
        {stock === null && <p>Choose a vehicle in step 1 to see its videos. All finished videos are in the Library.</p>}
        {stock !== null && s.jobs && !rows.length && <p>No videos for this vehicle yet. Generate one in step 5.</p>}
        <LatestFirst key={(s.clients.current ?? '') + '|' + (stock ?? '')} items={rows} noun="video" render={(j) => <Job key={j.id} j={j} say={say} openCaptions={openCaptions} />} />
      </div>
      {s.captionJob && <CaptionEditor draft={draft} setDraft={setDraft} />}
      </Editable>
    </section>
  );
}

function Job({ j, say, openCaptions }) {
  const s = useStudio();
  const [checking, setChecking] = useState(false);
  const [label, tone] = stage(j);
  const poll = async () => {
    setChecking(true);
    try { await api('poll', { id: j.id }); await s.loadJobs(); say('Status updated.'); } catch (e) { say(e.message, true); } finally { setChecking(false); }
  };
  const remove = async () => {
    try { say((await api('job_delete', { id: j.id })).message); await s.loadJobs(); } catch (e) { say(e.message, true); }
  };
  const details = [j.spokesperson, j.format?.replace('_', ' '), j.duration ? j.duration + ' s' : '', VOICE[j.voice] || '', j.created_at ? new Date(j.created_at).toLocaleString() : '', j.approved_by ? 'approved by ' + j.approved_by : ''].filter(Boolean).join(' · ');
  return (
    <div className="job">
      <div className="job-head"><strong>{j.vehicle}</strong><span className={'badge ' + tone}>{label}</span></div>
      <small>{details}</small>
      {j.error && <p>{j.error}</p>}
      {j.finish_error && <p>{j.finish_error}</p>}
      <div className="actions">
        {j.captioned_url?.startsWith('https://') && <Link href={j.captioned_url} className="button">Download final video</Link>}
        {j.video_url?.startsWith('https://') && <Link href={j.video_url}>Open uncaptioned master</Link>}
        {j.request_id && j.status !== 'completed' && <button className="secondary small" disabled={checking} onClick={poll}>Check status</button>}
        {j.status === 'completed' && !['queued', 'rendering'].includes(j.finish_status) && (
          <button className="secondary small" onClick={() => openCaptions(j.id)}>{j.finish_status === 'completed' ? 'Edit captions' : 'Add captions'}</button>
        )}
        {!GENERATING.includes(j.status) && j.finish_status !== 'rendering' && (
          <DangerButton label="Delete video" what={`this video for ${j.vehicle}`} detail="The job and its captioned file are removed from the dashboard. The original stays in your Higgsfield history." onConfirm={remove} />
        )}
      </div>
    </div>
  );
}

function CaptionEditor({ draft, setDraft }) {
  const s = useStudio();
  const [, say] = s.statuses.captions;
  const [rendering, setRendering] = useState(false);
  const render = async () => {
    setRendering(true);
    try { say((await api('finish', { id: s.captionJob, srt: draft.srt, reviewed: draft.reviewed })).message); await s.loadJobs(); }
    catch (e) { say(e.message, true); } finally { setRendering(false); }
  };
  return (
    <section id="captionEditor" className="studio">
      <h3>Edit captions</h3>
      <p className="hint">Check wording and timing against the video. You can paste a corrected SRT. Prices stay numeric.</p>
      <textarea id="captionSrt" rows={14} value={draft.srt} onChange={(e) => setDraft({ ...draft, srt: e.target.value })} />
      <label className="check"><input id="captionReviewed" type="checkbox" checked={draft.reviewed} onChange={(e) => setDraft({ ...draft, reviewed: e.target.checked })} />I checked the captions against the video.</label>
      <div className="actions">
        <button id="renderCaptions" disabled={rendering || !draft.reviewed} title={draft.reviewed ? undefined : 'Tick “I checked the captions against the video” first'} onClick={render}>Render captioned video</button>
        <button type="button" className="secondary" id="closeCaptions" onClick={() => s.setCaptionJob(null)}>Close</button>
      </div>
    </section>
  );
}
