(() => {
  const n = id => document.getElementById(id);
  let pending = false;
  async function act(action, data) {
    if (pending) return;
    pending = true;
    try {
      const result = await api(action, data);
      if (result.message) message(result.message);
      await refresh();
      return result;
    } catch (error) { message(error.message); }
    finally { pending = false; }
  }
  function option(select, value, label) {
    const o = el('option', label); o.value = value; select.append(o);
  }
  function deleteButton(label, question, action, id) {
    const b = el('button', label); b.type = 'button'; b.className = 'secondary';
    b.onclick = () => { if (confirm(question)) act(action, {id}); };
    return b;
  }
  n('nCopyScript').onclick = async () => {
    if (!chosen) { message('Select a vehicle first.'); return; }
    // Copy the script currently in the editor (the duration's default unless edited).
    const script = $('script').value.trim() || chosen.scripts?.[$('duration').value] || chosen.script;
    n('nCaptions').value = script;
    let r;
    try { r = await api('speech', {script}); }
    catch (error) { message(error.message); return; }
    n('nText').value = r.speech.replace(/my golden auto dot N, E, T/gi, 'my golden auto dot net');
    n('nDuration').value = $('duration').value;
    n('nPreviewSpend').checked = false;
    message('Narration and caption drafts copied. Edit narration pronunciation independently of captions.');
  };
  // Voices load when the page opens (listing is free); Bella is the default when the account has her.
  async function loadVoices(automatic) {
    if (pending) return;
    pending = true;
    try {
      const r = await api('narration_voices');
      const current = n('nVoice').value;
      n('nVoice').replaceChildren();
      option(n('nVoice'), '', 'Choose a voice');
      for (const voice of r.voices) {
        const labels = [voice.labels.gender, voice.labels.accent, voice.labels.age].filter(Boolean).join(', ');
        option(n('nVoice'), voice.id, voice.name + (labels ? ` — ${labels}` : ''));
      }
      const bella = r.voices.find(voice => /^bella\b/i.test(voice.name));
      n('nVoice').value = r.voices.some(voice => voice.id === current) ? current : (bella ? bella.id : '');
      if (!automatic) message(bella ? 'Voices loaded. Bella is selected by default.' : 'Voices loaded. Choose a voice and create a preview to hear it.');
    } catch (error) { message(error.message); }
    finally { pending = false; }
  }
  n('nLoadVoices').onclick = () => loadVoices(false);
  n('nCreatePreview').onclick = () => {
    if (!chosen) { message('Select a vehicle first.'); return; }
    act('narration_preview', {stock: chosen.StockNumber, voice_id: n('nVoice').value,
      text: n('nText').value, caption_script: n('nCaptions').value,
      duration: Number(n('nDuration').value), approve_spend: n('nPreviewSpend').checked,
      new_take: n('nNewTake').checked});
    n('nPreviewSpend').checked = false;
    n('nNewTake').checked = false;
  };
  async function refresh() {
    const r = await api('narration_list');
    const selectedAudio = n('nApproved').value, selectedVideo = n('nVideo').value;
    n('nApproved').replaceChildren(); option(n('nApproved'), '', 'Choose an approved preview');
    n('nVideo').replaceChildren(); option(n('nVideo'), '', 'Choose a completed video');
    for (const video of r.videos) option(n('nVideo'), video.id, `${video.vehicle} · ${video.duration}s · ${video.id.slice(0, 8)}`);
    n('nPreviews').replaceChildren();
    for (const preview of r.previews) {
      const box = el('div'); box.className = 'job';
      box.append(el('strong', preview.vehicle), el('span', `${preview.status} · ${preview.audio_duration ? preview.audio_duration.toFixed(1) + 's' : ''} · ${preview.id.slice(0, 8)}`));
      box.append(el('p', 'Narration: ' + preview.text), el('p', 'Captions: ' + preview.caption_script));
      if (preview.error) box.append(el('p', preview.error));
      if (preview.status === 'ready' && preview.audio_url) {
        const audio = el('audio'); audio.controls = true; audio.preload = 'none';
        audio.src = preview.audio_url; box.append(audio);
        if (preview.too_long) box.append(el('p', 'Audio is too long for the target video. Revise and create a new preview.'));
        else if (preview.approved) {
          box.append(el('small', 'Pronunciation approved'));
          option(n('nApproved'), preview.id, `${preview.vehicle} · ${preview.duration}s · ${preview.id.slice(0, 8)}`);
        } else {
          const label = el('label'); label.className = 'check';
          const checkbox = el('input'); checkbox.type = 'checkbox';
          label.append(checkbox, document.createTextNode('I listened to the full preview and checked the model name, price, website and timing.'));
          const approve = el('button', 'Approve this narration'); approve.type = 'button'; approve.className = 'secondary';
          approve.onclick = () => act('narration_approve', {id: preview.id, reviewed: checkbox.checked});
          box.append(label, approve);
        }
      }
      if (preview.status !== 'submitting') box.append(deleteButton('Delete preview',
        `Delete this voice preview for ${preview.vehicle}? Its audio file is removed. Previews used by a lip-sync video cannot be deleted.`,
        'narration_delete', preview.id));
      n('nPreviews').append(box);
    }
    n('nApproved').value = selectedAudio;
    n('nVideo').value = selectedVideo;
    n('nSyncJobs').replaceChildren();
    for (const job of r.lipsync) {
      const box = el('div'); box.className = 'job';
      box.append(el('strong', job.vehicle), el('span', 'Lip-sync: ' + job.status));
      if (job.error) box.append(el('p', job.error));
      if (job.request_id && !['completed', 'failed'].includes(job.status)) {
        const poll = el('button', 'Refresh lip-sync status'); poll.type = 'button'; poll.className = 'secondary';
        poll.onclick = async () => { await act('narration_poll', {id: job.id}); await jobs(); };
        box.append(poll);
      }
      if (job.video_url && job.video_url.startsWith('https://')) {
        const a = el('a', 'Open video with approved narration'); a.href = job.video_url;
        a.target = '_blank'; a.rel = 'noopener noreferrer'; box.append(a);
      }
      if (job.status === 'submission_uncertain') box.append(el('p', 'Check fal request history before any retry.'));
      if (!['submitting', 'queued', 'in_progress'].includes(job.status)) box.append(deleteButton('Delete lip-sync job',
        `Delete this lip-sync job for ${job.vehicle}?` + (job.status === 'completed' ? ' The finished video stays in Video jobs.' : ''),
        'narration_lipsync_delete', job.id));
      n('nSyncJobs').append(box);
    }
  }
  n('nRefresh').onclick = () => { if (!pending) refresh().catch(e => message(e.message)); };
  n('nSubmitSync').onclick = () => {
    act('narration_lipsync', {narration_id: n('nApproved').value, video_id: n('nVideo').value,
      approve_spend: n('nSyncSpend').checked, confirm_current: n('nCurrent').checked});
    n('nSyncSpend').checked = false;
  };
  refresh().catch(e => message(e.message)).finally(() => loadVoices(true));
})();
