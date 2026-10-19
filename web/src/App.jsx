// Golden Auto Video Studio: pick a car, approve the words and voice, generate; the captioned final video is built on
// the server. App holds the shared state (client, inventory, chosen car, script and video choices, videos, voice
// previews) and gives it to the steps through StudioContext.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, boot } from './api.js';
import { Notifications, Popups, useStatus, vehicleName } from './ui.jsx';
import VehicleStep, { ClientPanel } from './VehicleStep.jsx';
import ScriptStep from './ScriptStep.jsx';
import VoiceStep from './VoiceStep.jsx';
import LookStep from './LookStep.jsx';
import GenerateStep from './GenerateStep.jsx';
import Videos from './Videos.jsx';
import Tools from './Tools.jsx';

const Studio = createContext(null);
export const useStudio = () => useContext(Studio);

export const GENERATING = ['preparing_references', 'submitting', 'queued', 'in_progress'];

export default function App() {
  // Server data.
  const [clients, setClients] = useState({ items: [], current: null });
  const [inventory, setInventory] = useState(null);
  const [syncLog, setSyncLog] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [narr, setNarr] = useState({ previews: [], videos: [], lipsync: [] });
  const [spokespersons, setSpokespersons] = useState({ items: [], default: null });
  // The video being prepared.
  const [chosen, setChosen] = useState(null);
  const [duration, setDurationRaw] = useState('30');
  const [script, setScript] = useState('');
  const [voice, setVoiceRaw] = useState('elevenlabs');
  const [style, setStyleRaw] = useState('showroom');
  const [source, setSourceRaw] = useState('ai');
  const [format, setFormat] = useState('instagram_reels');
  const [spokespersonId, setSpokespersonId] = useState('');
  const [approvedVoice, setApprovedVoice] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [footage, setFootage] = useState(null);
  const [approve, setApprove] = useState(false);
  const [confirmCurrent, setConfirmCurrent] = useState(false);
  const [captionJob, setCaptionJob] = useState(null);
  const [spokespersonPanelOpen, setSpokespersonPanelOpen] = useState(false);
  // One action at a time, as before: a second click while one runs is ignored.
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  }, []);
  // Status messages, one pop-up per section (see useStatus).
  const statuses = {
    vehicle: useStatus('vehicle'), sheet: useStatus('sheet'), generate: useStatus('generate'), videos: useStatus('videos'), captions: useStatus('captions'),
    studio: useStatus('studio'), builder: useStatus('builder'), spokesperson: useStatus('spokesperson'), import: useStatus('import'),
  };
  const sayVehicle = statuses.vehicle[1];

  const client = clients.items.find((c) => c.id === clients.current) ?? null;

  // ---- Loaders ----------------------------------------------------------------------------------
  const loadClients = useCallback(async () => { const r = await api('clients'); setClients(r); return r; }, []);
  const loadInventory = useCallback(async () => {
    try { setInventory(await api('inventory')); } catch (e) { sayVehicle(e.message, true); }
  }, [sayVehicle]);
  const loadSyncLog = useCallback(async () => {
    try { setSyncLog(await api('sync_log')); } catch (e) { sayVehicle(e.message, true); }
  }, [sayVehicle]);
  const sayVideos = statuses.videos[1];
  const loadJobs = useCallback(async () => {
    try { setJobs((await api('jobs')).map((r) => JSON.parse(r))); } catch (e) { sayVideos(e.message, true); }
  }, [sayVideos]);
  const refreshNarrations = useCallback(async () => { const r = await api('narration_list'); setNarr(r); return r; }, []);
  const saySpokesperson = statuses.spokesperson[1];
  const loadSpokespersons = useCallback(async () => {
    try { showSpokespersons(await api('spokesperson_list')); } catch (e) { saySpokesperson(e.message, true); }
  }, [saySpokesperson]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A new spokesperson library; keeps the current choice when it still exists, else the default. */
  function showSpokespersons(lib, select = null) {
    setSpokespersons(lib);
    setSpokespersonId((keep) => select ?? (lib.items.some((s) => s.id === keep) ? keep : lib.default || ''));
    if (!lib.items.length) setSpokespersonPanelOpen(true);
  }

  /** Back to "no vehicle selected" (after a refresh or a client switch). */
  function clearVehicle() {
    setChosen(null); setScript(''); setSheetUrl(''); setApprove(false); setConfirmCurrent(false); setCaptionJob(null);
  }
  /** Show the session's current client: its saved inventory, videos and voice previews, without reloading the page. */
  async function showClientData() {
    await loadClients(); clearVehicle(); setInventory(null);
    await Promise.all([loadInventory(), loadJobs(), loadSyncLog()]);
    refreshNarrations().catch((e) => statuses.studio[1](e.message, true));
  }

  useEffect(() => {
    loadSpokespersons();
    loadSyncLog();
    (async () => {
      try { await loadClients(); await loadInventory(); await loadJobs(); } catch (e) { sayVehicle(e.message, true); }
    })();
    refreshNarrations().catch((e) => statuses.studio[1](e.message, true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // While a website import is still copying photos, re-read the inventory every 20 seconds (same client only).
  const pendingPhotos = (inventory?.vehicles ?? []).filter((v) => v.active !== false && v.photos_pending).length;
  useEffect(() => {
    if (!pendingPhotos) return undefined;
    const t = setTimeout(loadInventory, 20000);
    return () => clearTimeout(t);
  }, [inventory, pendingPhotos, loadInventory]);
  // A car whose photos finished importing while it is open: say so (reopening it would replace script edits).
  useEffect(() => {
    if (!chosen?.photos_pending || !inventory) return;
    if ((inventory.vehicles ?? []).some((v) => v.StockNumber === chosen.StockNumber && !v.photos_pending)) {
      setChosen((c) => ({ ...c, photos_pending: false }));
      sayVehicle(`Photos for the ${vehicleName(chosen)} are ready. Click the car in step 1 to see them.`);
    }
  }, [inventory]); // eslint-disable-line react-hooks/exhaustive-deps

  // Videos being made: refresh the list every 30 seconds.
  const activeJobs = (jobs ?? []).some((j) => GENERATING.includes(j.status) || (j.status === 'completed' && (['queued', 'rendering'].includes(j.finish_status) || !j.finish_status)));
  useEffect(() => {
    if (!activeJobs) return undefined;
    const t = setTimeout(loadJobs, 30000);
    return () => clearTimeout(t);
  }, [jobs, activeJobs, loadJobs]);

  // ---- Choices that affect each other ------------------------------------------------------------
  /** Swap to the default script for a length unless the user has edited it. */
  function defaultScript(len, car = chosen) {
    if (!car?.scripts) return;
    setScript((v) => (v.trim() === '' || Object.values(car.scripts).includes(v.trim()) ? car.scripts[len] || car.script : v));
  }
  function setDuration(len) { setDurationRaw(len); defaultScript(len); }
  function setStyle(s) {
    setStyleRaw(s);
    if (s === 'dynamic') setDuration('15');
  }
  function setVoice(v) {
    setVoiceRaw(v);
    // Dynamic product sequences exist only for the lip-sync method.
    if (v !== 'narration' && style !== 'showroom') setStyleRaw('showroom');
  }
  function setSource(s) {
    setSourceRaw(s);
    // Footage always uses the approved ElevenLabs voice from step 3.
    if (s === 'footage' && voice !== 'elevenlabs') setVoice('elevenlabs');
  }

  const spokesperson = spokespersons.items.find((s) => s.id === spokespersonId) ?? null;
  // Approved, ready previews for this car and length: the choices for step 3's "approved voice preview".
  const approvedPreviews = chosen ? narr.previews.filter((p) => p.approved && p.status === 'ready' && p.stock === chosen.StockNumber && String(p.duration) === duration) : [];
  useEffect(() => {
    setApprovedVoice((keep) => (approvedPreviews.some((p) => p.id === keep) ? keep : approvedPreviews[0]?.id ?? ''));
  }, [narr, chosen?.StockNumber, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = {
    boot, client, clients, setClients, inventory, setInventory, syncLog, jobs, narr, spokespersons, spokesperson,
    chosen, setChosen, duration, setDuration, script, setScript, voice, setVoice, style, setStyle, source, setSource,
    format, setFormat, spokespersonId, setSpokespersonId, approvedVoice, setApprovedVoice, approvedPreviews,
    sheetUrl, setSheetUrl, footage, setFootage, approve, setApprove, confirmCurrent, setConfirmCurrent,
    captionJob, setCaptionJob, spokespersonPanelOpen, setSpokespersonPanelOpen,
    busy, run, statuses, loadClients, loadInventory, loadJobs, loadSyncLog, refreshNarrations, showSpokespersons,
    clearVehicle, showClientData, defaultScript,
  };

  const signOut = async () => { try { await api('logout'); } finally { location.reload(); } };
  return (
    <Studio.Provider value={ctx}>
      <Popups />
      {boot.banner && <div className="staging-banner">{boot.banner}</div>}
      <header>
        <div>
          <span className="eyebrow">{client ? client.name.toUpperCase() : 'GOLDEN AUTO / SAN RAMON'}</span>
          <h1>Inventory → video</h1>
          <p>Pick a car, approve the words, generate. The final captioned video is built for you.</p>
        </div>
        <div className="header-actions">
          <Notifications />
          <button className="secondary" id="logout" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <nav className="steps" aria-label="Steps">
        <a href="#stepVehicle"><b>1</b> Vehicle</a><a href="#stepScript"><b>2</b> Script</a><a href="#stepVoice"><b>3</b> Voice</a>
        <a href="#stepLook"><b>4</b> Look</a><a href="#stepGenerate"><b>5</b> Generate</a><a href="#videos"><b>✓</b> Videos</a>
      </nav>
      <main>
        <ClientPanel />
        <div className="workspace">
          <VehicleStep />
          <div className="steps-col">
            <ScriptStep />
            <VoiceStep />
            <LookStep />
            <GenerateStep />
          </div>
        </div>
        <Videos />
        <Tools />
      </main>
    </Studio.Provider>
  );
}
