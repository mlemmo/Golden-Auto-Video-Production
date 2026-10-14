<section id="narrationStudio">
<h2>Narration first</h2>
<p class="hint">Make and listen to a voice preview before paying for lip-sync. Reuse a completed video with one clearly visible spokesperson. The new version uses the approved voice track; original dialogue and background audio are replaced.</p>
<div class="actions"><button type="button" id="nCopyScript" class="secondary">Copy selected vehicle script</button><button type="button" id="nLoadVoices" class="secondary">Reload ElevenLabs voices</button></div>
<label>Voice<select id="nVoice"><option value="">Loading voices…</option></select></label>
<label>Narration text — edit pronunciation here<textarea id="nText" rows="4" maxlength="1200"></textarea></label>
<label>Caption text — correct model spelling and numeric price<textarea id="nCaptions" rows="4" maxlength="1200"></textarea></label>
<label>Target duration<select id="nDuration"><option value="15">15 seconds</option><option value="30">30 seconds</option></select></label>
<label class="check"><input type="checkbox" id="nPreviewSpend">I approve one paid ElevenLabs voice preview at my account’s current rate.</label>
<label class="check"><input type="checkbox" id="nNewTake">Create another paid take even if an identical preview already exists.</label>
<div class="actions"><button type="button" id="nCreatePreview">Create voice preview</button><button type="button" id="nRefresh" class="secondary">Refresh narration jobs</button></div>
<div id="nPreviews"></div>
<h3>Use approved narration for lip-sync</h3>
<label>Approved voice preview<select id="nApproved"><option value="">Approve a preview first</option></select></label>
<label>Completed source video<select id="nVideo"><option value="">Refresh to load completed videos</option></select></label>
<p class="hint">The preview and source video must match vehicle, price and duration. Shorter narration is padded with silence; longer narration must be revised. Review the new video for face quality and lip-sync before posting.</p>
<label class="check"><input type="checkbox" id="nCurrent">I confirm this vehicle is available and the advertised price is current.</label>
<label class="check"><input type="checkbox" id="nSyncSpend">I approve one paid fal Sync Lipsync request at my account’s current rate.</label>
<button type="button" id="nSubmitSync">Submit lip-sync with approved audio</button>
<div id="nSyncJobs"></div>
</section>
