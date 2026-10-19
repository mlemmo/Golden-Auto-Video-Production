// Step 2: the script the spokesperson says, drafted from the listing, and its spoken length.
import { useEffect, useState } from 'react';
import { api } from './api.js';
import { StepHead, useStudio } from './App.jsx';
import { miles, price, vehicleName } from './ui.jsx';

export default function ScriptStep() {
  const s = useStudio();
  const c = s.chosen;
  const label = s.voice === 'narration' ? 'Script — copied to the ElevenLabs voice; the video itself is silent' : 'Script — the spokesperson says this in the video';
  return (
    <section className={s.stepClass('stepScript')} id="stepScript">
      <StepHead id="stepScript" num="2" title={<h2>Script</h2>} sub={<p>{c ? `${c.Year} ${c.Make} ${c.Model} · ` : ''}What the spokesperson says. It is drafted from the listing; edit it freely.</p>} />
      <span className="eyebrow">SELECTED VEHICLE</span>
      <h3 id="selected">{c ? vehicleName(c) : 'Select a vehicle in step 1'}</h3>
      <div id="facts" className="facts">{c ? `${c.Trim} · ${price(c)} · ${miles(c)} miles · #${c.StockNumber}` : ''}</div>
      <details className="sub"><summary>Website description</summary><p id="description">{c ? c.description || 'No description found.' : ''}</p></details>
      <label>Video length
        <select id="duration" value={s.duration} disabled={s.style === 'dynamic'} onChange={(e) => s.setDuration(e.target.value)}>
          <option value="30">30 seconds — full walkaround</option><option value="15">15 seconds — short ad</option>
        </select>
      </label>
      <label><span id="scriptLabel">{label}</span>
        <textarea id="script" rows={5} maxLength={600} placeholder="Choose a vehicle to draft its script." value={s.script} onChange={(e) => s.setScript(e.target.value)} />
      </label>
      <SpokenLength />
    </section>
  );
}

/** Spoken word count and spoken form, checked 250 ms after typing stops. The last count stays while typing. */
function SpokenLength() {
  const s = useStudio();
  const [, sayVehicle] = s.statuses.vehicle;
  const [result, setResult] = useState(null);   // { words, speech } for the current text
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let live = true;
    setPending(true);
    const t = setTimeout(async () => {
      try { const d = await api('speech', { script: s.script }); if (live) { setResult(d); setPending(false); } }
      catch (e) { if (live) sayVehicle(e.message, true); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [s.script, sayVehicle]);
  const thirty = s.duration === '30', limit = thirty ? 62 : 38;
  let text, tooLong = false;
  if (pending) text = result && s.script.trim() ? `${result.words} spoken words · updating…` : 'Checking spoken length…';
  else {
    tooLong = result.words > limit;
    text = `${result.words} spoken words · aim for ${thirty ? '55–60' : 'up to 38'} for ${s.duration} seconds` + (tooLong ? ' — too long, shorten it' : '');
  }
  return (
    <>
      <p className={'hint' + (tooLong ? ' error' : '')} id="wordCount">{text}</p>
      <details className="sub"><summary>How it will be spoken (numbers and codes written out)</summary><p id="speechPreview">{result?.speech ?? ''}</p></details>
    </>
  );
}
