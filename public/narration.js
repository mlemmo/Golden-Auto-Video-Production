(() => {
  const n = id => document.getElementById(id);
  const studio = () => statusOf('voiceStudio');
  const builder = () => n('lipsyncPanel').querySelector('.status');
  let pending = false;
  async function act(action, data, target) {
    if (pending) return;
    pending = true;
    try {
      const result = await api(action, data);
      if (result.message) message(result.message, target);
      await refresh();
      await approvedVoices();
      return result;
    } catch (error) { fail(error.message, target); }
    finally { pending = false; }
  }
  function option(select, value, label) { const o = el('option', label); o.value = value; select.append(o); }

  // 1. Copy the script from step 2 (spoken form for the voice, normal spelling for captions).
  n('nCopyScript').onclick = async () => {
    if (!chosen) { fail('Select a vehicle in step 1 first.', studio()); return; }
    const script = $('script').value.trim() || chosen.scripts?.[$('duration').value] || chosen.script;
    n('nCaptions').value = script;
    let r;
    try { r = await api('speech', {script}); }
    catch (error) { fail(error.message, studio()); return; }
    n('nText').value = r.speech.replace(/my golden auto dot N, E, T/gi, 'my golden auto dot net');
    n('nDuration').value = $('duration').value;
    n('nPreviewSpend').checked = false;
    message('Script copied. Respell any word in the spoken text if needed, then create a preview.', studio());
  };

  // 2. Voices load when the page opens (listing is free); Bella is the default when the account has her.
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
      if (!automatic) message(bella ? 'Voices loaded. Bella is selected by default.' : 'Voices loaded. Choose a voice.', studio());
    } catch (error) { fail(error.message, studio()); }
    finally { pending = false; }
  }
  n('nLoadVoices').onclick = () => loadVoices(false);

  // 3. Paid preview, using the video length chosen in step 2.
  n('nCreatePreview').onclick = () => {
    if (!chosen) { fail('Select a vehicle in step 1 first.', studio()); return; }
    if (!n('nText').value.trim()) { fail('Copy the script from step 2 first.', studio()); return; }
    n('nDuration').value = $('duration').value;
    message('Creating the voice preview…', studio());
    act('narration_preview', {stock: chosen.StockNumber, voice_id: n('nVoice').value,
      text: n('nText').value, caption_script: n('nCaptions').value,
      duration: Number($('duration').value), approve_spend: n('nPreviewSpend').checked,
      new_take: n('nNewTake').checked}, studio());
    n('nPreviewSpend').checked = false;
    n('nNewTake').checked = false;
  };

  async function refresh() {
    const r = await api('narration_list');
    const selectedAudio = n('nApproved').value, selectedVideo = n('nVideo').value;
    n('nApproved').replaceChildren(); option(n('nApproved'), '', 'Choose an approved preview');
    n('nVideo').replaceChildren(); option(n('nVideo'), '', 'Choose a completed video');
    for (const video of r.videos) option(n('nVideo'), video.id, `${video.vehicle} · ${video.duration}s · ${video.id.slice(0, 8)}`);

    // Previews: the selected car's only (newest first), so the list matches what you are working on.
    const previews = chosen ? r.previews.filter(p => p.stock === chosen.StockNumber) : r.previews;
    n('nPreviews').replaceChildren();
    if (chosen && !previews.length) n('nPreviews').append(el('p', 'No voice previews for this car yet.'));
    for (const preview of previews) {
      const box = el('div'); box.className = 'job';
      const head = el('div'); head.className = 'job-head';
      const state = preview.status !== 'ready' ? [preview.status, 'busy'] : preview.too_long ? ['Too long', 'bad'] : preview.approved ? ['Approved', 'ok'] : ['Listen and approve', 'busy'];
      const badge = el('span', state[0]); badge.className = 'badge ' + state[1];
      head.append(el('strong', `${preview.vehicle} · ${preview.duration}s${preview.audio_duration ? ' · ' + preview.audio_duration.toFixed(1) + 's of speech' : ''}`), badge);
      box.append(head, el('p', 'Spoken: ' + preview.text), el('p', 'Captions: ' + preview.caption_script));
      if (preview.text_mismatch && preview.text_mismatch.length) {
        const warn = el('p', 'Caption text and spoken text differ: ' + preview.text_mismatch.slice(0, 5).join('; ') + '. Captions show the caption text, so fix one of them if they should match.');
        warn.className = 'mismatch'; box.append(warn);
      }
      if (preview.error) box.append(el('p', preview.error));
      const actions = el('div'); actions.className = 'actions';
      if (preview.status === 'ready' && preview.audio_url) {
        const audio = el('audio'); audio.controls = true; audio.preload = 'none'; audio.src = preview.audio_url; box.append(audio);
        if (preview.too_long) box.append(el('p', 'Too long for the video. Shorten the script and create a new preview.'));
        else if (preview.approved) option(n('nApproved'), preview.id, `${preview.vehicle} · ${preview.duration}s · ${preview.id.slice(0, 8)}`);
        else {
          const label = el('label'); label.className = 'check';
          const checkbox = el('input'); checkbox.type = 'checkbox';
          label.append(checkbox, document.createTextNode('I listened to the whole preview and every word, number and name sounds right.'));
          const approve = el('button', 'Approve this voice'); approve.type = 'button'; approve.className = 'small';
          approve.onclick = () => act('narration_approve', {id: preview.id, reviewed: checkbox.checked}, studio());
          box.append(label); actions.append(approve);
        }
      }
      if (preview.status !== 'submitting') actions.append(dangerButton('Delete preview',
        () => act('narration_delete', {id: preview.id}, studio()),
        `this voice preview for ${preview.vehicle}`, 'Its audio file is removed. Previews used by a finished video cannot be deleted.'));
      box.append(actions);
      n('nPreviews').append(box);
    }
    n('nApproved').value = selectedAudio;
    n('nVideo').value = selectedVideo;

    // Lip-sync builder jobs (Tools).
    n('nSyncJobs').replaceChildren();
    let building = false;
    const stage = {waiting: 'preparing captions', queued: 'queued for final render', rendering: 'rendering final video', completed: 'final video ready', failed: 'final build failed'};
    for (const job of r.lipsync) {
      const box = el('div'); box.className = 'job';
      box.append(el('strong', job.vehicle), el('span', 'Lip-sync: ' + job.status + (job.final ? ' · ' + (stage[job.final.status] || job.final.status) : '')));
      if (job.auto_build && (['submitting', 'queued', 'in_progress', 'unknown'].includes(job.status) || (job.final && ['waiting', 'queued', 'rendering'].includes(job.final.status)))) {
        building = true; box.append(el('small', 'Building automatically — this list refreshes every 30 seconds.'));
      }
      if (job.final && job.final.error) box.append(el('p', job.final.error));
      const actions = el('div'); actions.className = 'actions';
      if (job.final && job.final.url && job.final.url.startsWith('https://')) actions.append(link('Download final video', job.final.url));
      if (job.error) box.append(el('p', job.error));
      if (job.request_id && !['completed', 'failed'].includes(job.status)) {
        const poll = el('button', 'Check lip-sync status'); poll.type = 'button'; poll.className = 'secondary small';
        poll.onclick = async () => { await act('narration_poll', {id: job.id}, builder()); await jobs(); };
        actions.append(poll);
      }
      if (job.video_url && job.video_url.startsWith('https://')) actions.append(link('Open video with approved narration', job.video_url));
      if (job.status === 'submission_uncertain') box.append(el('p', 'Check fal request history before any retry.'));
      if (!['submitting', 'queued', 'in_progress'].includes(job.status)) actions.append(dangerButton('Delete lip-sync job',
        () => act('narration_lipsync_delete', {id: job.id}, builder()),
        `this lip-sync job for ${job.vehicle}`, job.status === 'completed' ? 'The finished video stays under Videos.' : 'Nothing else is affected.'));
      box.append(actions);
      n('nSyncJobs').append(box);
    }
    clearTimeout(buildTimer);
    if (building) buildTimer = setTimeout(() => { refresh().then(() => jobs()).catch(e => fail(e.message, builder())); }, 30000);
  }
  let buildTimer;
  window.refreshNarrations = refresh;
  n('nRefresh').onclick = () => { if (!pending) refresh().then(() => message('Previews refreshed.', studio())).catch(e => fail(e.message, studio())); };
  n('nSubmitSync').onclick = () => {
    act('narration_lipsync', {narration_id: n('nApproved').value, video_id: n('nVideo').value,
      approve_spend: n('nSyncSpend').checked, confirm_current: n('nCurrent').checked, auto_build: true}, builder());
    n('nSyncSpend').checked = false;
  };
  refresh().catch(e => fail(e.message, studio())).finally(() => loadVoices(true));
})();
