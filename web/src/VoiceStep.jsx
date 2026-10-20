// Step 3: how the voice is made. With the default method the user makes an ElevenLabs voice preview of the script,
// listens to all of it and approves it; Seedance then follows that voice, wording and pace.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { StepContinue, StepHead, useClientState, useStudio, Editable } from './App.jsx';
import { DangerButton, LatestFirst, newestFirst } from './ui.jsx';

export default function VoiceStep() {
  const s = useStudio();
  const eleven = s.voice === 'elevenlabs';
  return (
    <section className={s.stepClass('stepVoice')} id="stepVoice">
      <StepHead id="stepVoice" num="3" title={<h2>Voice</h2>} sub={<p>Choose how the spokesperson's voice is made.</p>} />
      <Editable>
      <label>Voice
        <select id="voice" value={s.voice} disabled={s.source === 'footage'} onChange={(e) => s.setVoice(e.target.value)}>
          <option value="elevenlabs">Approved ElevenLabs voice — guides the voice and words (recommended)</option>
          <option value="native">Seedance voice — made in the video, wording may vary</option>
          <option value="narration">ElevenLabs narration + lip-sync — older two-step method</option>
        </select>
      </label>
      <p className="hint" id="elevenHint" hidden={!eleven}>You make a voice preview below, listen to it and approve it. Seedance uses it as the voice, wording and pace to follow, and speaks it in the video so her lips match. <strong>Check names and numbers in the finished video.</strong></p>
      <p className="hint" id="voiceHint" hidden={s.voice !== 'native'}>Seedance creates the voice inside the video. Quick, but <strong>it may change or mispronounce words</strong>, and the voice differs between videos.</p>
      <p className="hint" id="narrationHint" hidden={s.voice !== 'narration'}>Seedance films a silent video; afterwards your approved voice preview is added by lip-sync (Tools → Lip-sync builder) and the final video is built automatically.</p>
      <VoiceStudio hidden={s.voice === 'native'} />
      <label id="approvedVoiceLabel" hidden={!eleven}>Approved voice preview to use for this video
        <select id="approvedVoice" value={s.approvedVoice} onChange={(e) => s.setApprovedVoice(e.target.value)}>
          {!s.chosen ? <option value="">Choose a vehicle first</option>
            : <option value="">{s.approvedPreviews.length ? 'Choose an approved preview' : `No approved ${s.duration}-second preview for this car yet — make one above`}</option>}
          {s.approvedPreviews.map((p) => <option key={p.id} value={p.id}>{`${p.duration}s · ${(p.text || '').slice(0, 70)}… · ${p.id.slice(0, 8)}`}</option>)}
        </select>
      </label>
      <StepContinue from="stepVoice" to="stepLook" label="Continue to step 4: Look"
        check={{ elevenlabs: 'Approved voice selected', native: 'Seedance voice chosen', narration: 'Voice preview approved for lip-sync' }[s.voice]}
        ready={!!s.chosen && (s.voice !== 'elevenlabs' || !!s.approvedVoice)}
        waiting={!s.chosen ? 'Choose a vehicle in step 1 first' : 'Choose an approved voice preview first'} />
      </Editable>
    </section>
  );
}

function VoiceStudio({ hidden }) {
  const s = useStudio();
  const [, say] = s.statuses.studio;
  const [voices, setVoices] = useState(null);
  // Each client keeps its own voice, spoken text and caption text (switching back shows them again).
  const [voiceId, setVoiceId] = useClientState('studio.voice', '');
  const [text, setText] = useClientState('studio.text', '');
  const [captions, setCaptions] = useClientState('studio.captions', '');
  const [spend, setSpend] = useState(false);
  const [newTake, setNewTake] = useState(false);
  const [pending, setPending] = useState(false);
  // Paid-approval boxes never carry over to another client.
  useEffect(() => { setSpend(false); setNewTake(false); }, [s.clients.current]);

  /** One narration action at a time; then the lists are refreshed. */
  async function act(action, data) {
    if (pending) return;
    setPending(true);
    try {
      const r = await api(action, data);
      if (r.message) say(r.message);
      await s.refreshNarrations();
    } catch (e) { say(e.message, true); }
    finally { setPending(false); }
  }
  // Voices load when the page opens (listing is free); Bella is the default when the account has her.
  async function loadVoices(automatic) {
    try {
      const r = await api('narration_voices');
      setVoices(r.voices);
      const bella = r.voices.find((v) => /^bella\b/i.test(v.name));
      setVoiceId((cur) => (r.voices.some((v) => v.id === cur) ? cur : bella ? bella.id : ''));
      if (!automatic) say(bella ? 'Voices loaded. Bella is selected by default.' : 'Voices loaded. Choose a voice.');
    } catch (e) { say(e.message, true); }
  }
  useEffect(() => { if (!s.readOnly) loadVoices(true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The step 2 script fills the spoken text (spoken form) and the caption text (normal spelling) by itself. Once you
  // have changed either one here (e.g. a respelled word), a later change in step 2 waits for "Update from step 2".
  const [copied, setCopied] = useClientState('studio.copied', { stock: '', script: '', text: '', captions: '' });
  const source = s.chosen ? (s.script.trim() || s.chosen.scripts?.[s.duration] || s.chosen.script || '') : '';
  // Edits only count for the car they were made for; another car always starts from its own script.
  const edited = copied.stock === (s.chosen?.StockNumber ?? '') && (text !== copied.text || captions !== copied.captions) && !(text === '' && captions === '');
  const stale = source !== '' && source !== copied.script;
  async function copyScript(manual) {
    if (!source) return;
    try {
      const r = await api('speech', { script: source });
      const spoken = r.speech.replace(/my golden auto dot N, E, T/gi, 'my golden auto dot net');
      setText(spoken); setCaptions(source); setCopied({ stock: s.chosen?.StockNumber ?? '', script: source, text: spoken, captions: source });
      setSpend(false);
      if (manual) say('Updated from step 2. Respell any word in the spoken text if needed, then create a preview.');
    } catch (e) { say(e.message, true); }
  }
  useEffect(() => {
    if (!stale || edited || s.readOnly) return undefined;
    const t = setTimeout(() => copyScript(false), 400);
    return () => clearTimeout(t);
  }, [source, edited, s.chosen?.StockNumber]); // eslint-disable-line react-hooks/exhaustive-deps
  // 3. Paid preview, using the video length chosen in step 2.
  function createPreview() {
    if (!s.chosen) { say('Select a vehicle in step 1 first.', 'warn'); return; }
    if (!text.trim()) { say('Write the script in step 2 first.', 'warn'); return; }
    say('Creating the voice preview…');
    act('narration_preview', { stock: s.chosen.StockNumber, voice_id: voiceId, voice_name: (voices ?? []).find((x) => x.id === voiceId)?.name ?? '', text, caption_script: captions, duration: Number(s.duration), approve_spend: spend, new_take: newTake });
    setSpend(false); setNewTake(false);
  }
  // Previews: the selected car's only (newest first), so the list matches what you are working on.
  const previews = newestFirst(s.chosen ? s.narr.previews.filter((p) => p.stock === s.chosen.StockNumber) : s.narr.previews);
  return (
    <div id="voiceStudio" className="studio" hidden={hidden}>
      <ol className="mini-steps"><li>The script from step 2 is filled in below by itself.</li><li>Pick a voice and fix any word that sounds wrong by respelling it in the spoken text.</li><li>Create a preview, listen to all of it, then approve it.</li></ol>
      <div className="actions">
        {stale && edited && <button type="button" id="nCopyScript" className="secondary" onClick={() => copyScript(true)}>The script in step 2 changed — Update from step 2</button>}
        <button type="button" id="nLoadVoices" className="secondary" onClick={() => loadVoices(false)}>Reload voices</button>
      </div>
      <label>ElevenLabs voice — use the same one for every car to keep a consistent voice
        <select id="nVoice" value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
          {voices === null ? <option value="">Loading voices…</option> : <option value="">Choose a voice</option>}
          {(voices ?? []).map((v) => {
            const labels = [v.labels.gender, v.labels.accent, v.labels.age].filter(Boolean).join(', ');
            return <option key={v.id} value={v.id}>{v.name + (labels ? ` — ${labels}` : '')}</option>;
          })}
        </select>
      </label>
      <label>Spoken text — respell words here to fix pronunciation (e.g. San Ruh-mone)<textarea id="nText" rows={4} maxLength={1200} value={text} onChange={(e) => setText(e.target.value)} /></label>
      <label>Caption text — what appears on screen; keep normal spelling<textarea id="nCaptions" rows={3} maxLength={1200} value={captions} onChange={(e) => setCaptions(e.target.value)} /></label>
      <label className="check note-important"><input type="checkbox" id="nPreviewSpend" checked={spend} onChange={(e) => setSpend(e.target.checked)} />I approve <b>one paid ElevenLabs voice preview</b> at my account’s current rate.</label>
      <label className="check"><input type="checkbox" id="nNewTake" checked={newTake} onChange={(e) => setNewTake(e.target.checked)} />Make another take even if an identical preview already exists.</label>
      <div className="actions">
        <button type="button" id="nCreatePreview" disabled={pending || !spend} title={spend ? undefined : 'Tick the paid voice preview approval first'} onClick={createPreview}>Create voice preview</button>
        <button type="button" id="nRefresh" className="secondary" disabled={pending} onClick={() => s.refreshNarrations().then(() => say('Previews refreshed.')).catch((e) => say(e.message, true))}>Refresh previews</button>
      </div>
      <div id="nPreviews" className="list">
        {s.chosen && !previews.length && <p>No voice previews for this car yet.</p>}
        <LatestFirst key={s.chosen?.StockNumber ?? 'all'} items={previews} noun="voice preview" render={(p) => <Preview key={p.id} p={p} act={act} voices={voices} />} />
      </div>
    </div>
  );
}

/** The voice a preview was made with: its name from the account's voice list (or as saved), else a short id. */
function voiceLabel(p, voices) {
  const v = (voices ?? []).find((x) => x.id === p.voice_id);
  const name = v?.name ?? p.voice_name;
  if (name) {
    const labels = v ? [v.labels?.gender, v.labels?.accent].filter(Boolean).join(', ') : '';
    return name + (labels ? ` (${labels})` : '');
  }
  return p.voice_id ? 'voice ' + p.voice_id.slice(0, 8) + '… (no longer in your ElevenLabs voices)' : 'unknown';
}

function Preview({ p, act, voices }) {
  const [reviewed, setReviewed] = useState(false);
  const state = p.status !== 'ready' ? [p.status, 'busy'] : p.too_long ? ['Too long', 'bad'] : p.approved ? ['Approved', 'ok'] : ['Listen and approve', 'busy'];
  return (
    <div className="job">
      <div className="job-head">
        <strong>{`${p.vehicle} · ${p.duration}s${p.audio_duration ? ' · ' + p.audio_duration.toFixed(1) + 's of speech' : ''}`}</strong>
        <span className={'badge ' + state[1]}>{state[0]}</span>
      </div>
      <p className="preview-voice"><b>Voice:</b> {voiceLabel(p, voices)}</p>
      {p.approved_by && <small>Made by {p.approved_by}</small>}
      <p>Spoken: {p.text}</p>
      <p>Captions: {p.caption_script}</p>
      {p.text_mismatch?.length > 0 && <p className="mismatch">{'Caption text and spoken text differ: ' + p.text_mismatch.slice(0, 5).join('; ') + '. Captions show the caption text, so fix one of them if they should match.'}</p>}
      {p.error && <p>{p.error}</p>}
      {p.status === 'ready' && p.audio_url && <audio controls preload="none" src={p.audio_url} />}
      {p.status === 'ready' && p.audio_url && p.too_long && <p>Too long for the video. Shorten the script and create a new preview.</p>}
      {p.status === 'ready' && p.audio_url && !p.too_long && !p.approved && (
        <label className="check note-important"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} />I listened to the whole preview and every word, number and name sounds right.</label>
      )}
      <div className="actions">
        {p.status === 'ready' && p.audio_url && !p.too_long && !p.approved && (
          <button type="button" className="small" disabled={!reviewed} title={reviewed ? undefined : 'Tick “I listened to the whole preview” first'} onClick={() => act('narration_approve', { id: p.id, reviewed })}>Approve this voice</button>
        )}
        {p.status !== 'submitting' && (
          <DangerButton label="Delete preview" what={`this voice preview for ${p.vehicle}`} detail="Its audio file is removed. Previews used by a finished video cannot be deleted."
            onConfirm={() => act('narration_delete', { id: p.id })} />
        )}
      </div>
    </div>
  );
}
