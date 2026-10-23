// Step 5: one paid generation (or a free build from the dealer's own footage). The captioned final video is then
// built on the server and appears under Videos.
import { api, upload } from './api.js';
import { StepHead, useStudio, Editable } from './App.jsx';
import { price, vehicleName } from './ui.jsx';

const FORMAT_NAME = { instagram_reels: 'Instagram Reels', facebook_reels: 'Facebook Reels', facebook_feed: 'Facebook Feed', square: 'Instagram / Facebook Square', youtube: 'YouTube 16:9' };
const SHAPE_NAME = { instagram_reels: '9:16', facebook_feed: '4:5', youtube: '16:9', square: '1:1' };
const showVideos = () => setTimeout(() => document.getElementById('videos')?.scrollIntoView({ behavior: 'smooth' }), 0);

export default function GenerateStep() {
  const s = useStudio();
  const [, say] = s.statuses.generate;
  const c = s.chosen, footage = s.source === 'footage', slideshow = s.source === 'slideshow', ai = s.source === 'ai';
  const approved = s.voice !== 'elevenlabs' || s.approvedVoice;
  const voiceText = { elevenlabs: 'approved ElevenLabs voice', native: 'Seedance voice', narration: 'silent video + ElevenLabs lip-sync' }[s.voice];
  const rows = [
    ['Vehicle', c ? `${vehicleName(c)} · ${price(c)}` : 'not selected', !!c],
    ['Voice', voiceText + (s.voice === 'elevenlabs' ? (approved ? ' · preview chosen' : ' · no approved preview yet') : ''), !!approved],
    footage ? ['Footage', s.footage?.name || 'no video chosen yet', !!s.footage]
      : slideshow ? ['Photos', `${(c?.photos ?? []).length} listing photos`, (c?.photos ?? []).length > 0] : ['Spokesperson', s.spokesperson?.name || 'none', !!s.spokesperson],
    ...(ai ? [['Setting', s.scene?.name || 'default', true]] : []),
    slideshow ? ['Videos', `${s.duration} s photo slideshow · ${s.shapes.map((k) => SHAPE_NAME[k]).join(', ') || 'no shape chosen'} · ${s.adCut ? 'ad cut · ' : ''}${s.background.startsWith('ai:') ? 'AI showroom (paid)' : s.background ? 'showroom background' : 'original photos'} · ${s.music ? 'with music' : 'no music'}`, s.shapes.length > 0]
      : ['Video', `${s.duration} s · ${FORMAT_NAME[s.format]} · ${footage ? 'your footage' : s.style === 'showroom' ? 'walkaround' : 'dynamic'}${footage ? '' : ' · ' + s.resolution}`, true],
  ];

  const generate = () => {
    if (!c) return;
    if (s.voice === 'elevenlabs' && !s.approvedVoice) { say('Choose an approved voice preview in step 3 first.', 'warn'); return; }
    s.run(async () => {
      say('Checking current availability and submitting one paid generation…');
      try {
        await api('generate', { stock: c.StockNumber, format: s.format, style: s.style, voice: s.voice, narration_id: s.approvedVoice, duration: Number(s.duration), resolution: s.resolution,
          script: s.script, sheet: s.sheetUrl, spokesperson: s.spokespersonId, scene: s.sceneId, approve_spend: s.approve, confirm_current: s.confirmCurrent });
        s.setApprove(false);
        say('Generation submitted. It takes a few minutes — follow it under Videos below.');
        await s.loadJobs(); s.openStep('videos'); showVideos();
      } catch (e) { say(e.message, true); }
    });
  };
  const buildFootage = () => {
    if (!c) return;
    if (!s.approvedVoice) { say('Choose an approved voice preview in step 3 first.', 'warn'); return; }
    if (!s.footage) { say('Choose the car video in step 4 first.', 'warn'); return; }
    if (s.footage.size > 64 * 1024 * 1024) { say('That video is larger than 64 MB. Export or film it at 1080p.', 'warn'); return; }
    s.run(async () => {
      say('Uploading your footage… this can take a minute on a slow connection.');
      try {
        const form = new FormData();
        form.append('stock', c.StockNumber); form.append('format', s.format); form.append('narration_id', s.approvedVoice);
        if (s.confirmCurrent) form.append('confirm_current', '1');
        form.append('footage', s.footage);
        say((await upload('footage_build', form)).message);
        await s.loadJobs(); s.openStep('videos'); showVideos();
      } catch (e) { say(e.message, true); }
    });
  };
  const buildSlideshow = () => {
    if (!c) return;
    if (!s.approvedVoice) { say('Choose an approved voice preview in step 3 first.', 'warn'); return; }
    if (!s.shapes.length) { say('Choose at least one video shape in step 4.', 'warn'); return; }
    s.run(async () => {
      say('Starting the slideshow videos…');
      try {
        say((await api('slideshow_build', { stock: c.StockNumber, narration_id: s.approvedVoice, formats: s.shapes, music: s.music, background: s.background, ad_cut: s.adCut, approve_ai_spend: s.aiApprove, confirm_current: s.confirmCurrent })).message);
        s.setAiApprove(false);   // the paid AI background approval covers this one build
        await s.loadJobs(); s.openStep('videos'); showVideos();
      } catch (e) { say(e.message, true); }
    });
  };
  const checkReferences = () => s.run(async () => {
    say('Uploading reference images to Higgsfield storage; no video is generated…');
    try { say((await api('references', { sheet: s.sheetUrl, spokesperson: s.spokespersonId })).message); } catch (e) { say(e.message, true); }
  });
  const downloadBrief = () => {
    const brief = { vehicle: c, format: s.format, duration: Number(s.duration), style: s.style, voice: s.voice, script: s.script,
      reference_images: { car_asset_sheet: s.sheetUrl, spokesperson: s.spokesperson?.url || '' }, spokesperson: s.spokesperson?.name || '', avatar_profile: s.spokesperson?.description || '', setting: s.scene ? { name: s.scene.name, blocks: s.scene.blocks ?? null, description: s.scene.description } : null, model: 'Seedance 2.5',
      shots: s.style === 'showroom' ? [{ shot: 1, direction: 'Wide front three-quarter; spokesperson beside the front fender' }, { shot: 2, direction: 'Wide side profile; she walks along the side' }, { shot: 3, direction: 'Wide rear three-quarter; she stands at the rear corner' }, { shot: 4, direction: 'Wide front from the other side; price and call to action' }]
        : [{ seconds: '0–4', direction: 'Ultra-low stabilized tracking' }, { seconds: '4–9', direction: 'Interior macro glide' }, { seconds: '9–15', direction: 'Drone dolly-out plus offer' }],
      finishing: 'Captions burned in as white text on black boxes; whole car in frame in every shot.' };
    const u = URL.createObjectURL(new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' })), a = document.createElement('a');
    a.href = u; a.download = `golden-auto-${c.StockNumber}-brief.json`; a.click(); URL.revokeObjectURL(u);
  };

  return (
    <section className={s.stepClass('stepGenerate')} id="stepGenerate">
      <StepHead id="stepGenerate" num="5" title={<h2>Generate</h2>} sub={<p>{ai ? 'One paid generation. The captioned final video is then built automatically and appears under Videos.' : 'Built free on this server from your approved voice. The captioned videos appear under Videos.'}</p>} />
      <Editable>
      <ul className="summary" id="summary">
        {rows.map(([k, v, ok]) => <li key={k} className={ok ? 'ok' : 'todo'}><b>{k}</b><span>{v}</span></li>)}
      </ul>
      <label id="resolutionLabel" hidden={!ai}>Quality
        <select id="resolution" value={s.resolution} onChange={(e) => s.setResolution(e.target.value)}>
          <option value="720p">720p — standard (about $9.71 for 30 s)</option>
          <option value="1080p">1080p — sharper badges and lettering (about 40% more)</option>
        </select>
      </label>
      <label className="check note-important" id="approveLabel" hidden={!ai}><input type="checkbox" id="approve" checked={s.approve} onChange={(e) => s.setApprove(e.target.checked)} />I reviewed the vehicle facts and script and approve <b>one paid Higgsfield generation</b> at my account’s current rate.</label>
      <label className="check note-important"><input type="checkbox" id="confirmCurrent" checked={s.confirmCurrent} onChange={(e) => s.setConfirmCurrent(e.target.checked)} />I confirm the vehicle is <b>available</b> and its advertised <b>price is current</b>.</label>
      <div className="actions">
        <button id="buildFootage" hidden={!footage} disabled={!c || s.busy || !s.confirmCurrent} title={s.confirmCurrent ? undefined : 'Tick “vehicle is available and price is current” first'} onClick={buildFootage}>Build video from my footage</button>
        <button id="buildSlideshow" hidden={!slideshow} disabled={!c || s.busy || !s.confirmCurrent || !s.shapes.length || (s.background.startsWith('ai:') && !s.aiApprove)} title={!s.confirmCurrent ? 'Tick “vehicle is available and price is current” first' : s.background.startsWith('ai:') && !s.aiApprove ? 'Tick the paid AI background approval in step 4 first' : undefined} onClick={buildSlideshow}>{`Build ${s.shapes.length === 1 ? 'slideshow video' : s.shapes.length + ' slideshow videos'}`}</button>
        <button id="generate" hidden={!ai} disabled={!c || s.busy || !s.approve || !s.confirmCurrent} title={s.approve && s.confirmCurrent ? undefined : 'Tick both boxes above first'} onClick={generate}>Generate video</button>
        <button className="secondary" id="checkReferences" hidden={!ai} disabled={s.busy} onClick={checkReferences}>Check reference uploads</button>
        <button className="secondary" id="brief" hidden={!ai} disabled={!c} onClick={downloadBrief}>Download production brief</button>
      </div>
      </Editable>
    </section>
  );
}
