<details class="import-panel" id="lipsyncPanel"><summary>Lip-sync builder — only for the “ElevenLabs narration + lip-sync” voice method</summary>
  <p class="hint">Choose an approved voice preview and a completed silent video of the same car, price and length, then approve once. Lip-sync runs, captions are timed from the narration and the final video is rendered automatically. Shorter narration is padded with silence; longer narration must be revised.</p>
  <label>Approved voice preview<select id="nApproved"><option value="">Approve a preview first</option></select></label>
  <label>Completed source video<select id="nVideo"><option value="">Refresh to load completed videos</option></select></label>
  <label class="check"><input type="checkbox" id="nCurrent">I confirm this vehicle is available and the advertised price is current.</label>
  <label class="check"><input type="checkbox" id="nSyncSpend">I approve one paid fal Sync Lipsync request at my account’s current rate; captions and the final render then run automatically.</label>
  <p class="status" role="status" hidden></p>
  <button type="button" id="nSubmitSync">Build final video with lip-sync</button>
  <div id="nSyncJobs" class="list"></div>
</details>
