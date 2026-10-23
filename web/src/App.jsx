// Golden Auto Video Studio: pick a car, approve the words and voice, generate; the captioned final video is built on
// the server. App holds the shared state (client, inventory, chosen car, script and video choices, videos, voice
// previews) and gives it to the steps through StudioContext.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, boot } from './api.js';
import { Notifications, Popups, useStatus, vehicleName } from './ui.jsx';
import { AccountMenu } from './Accounts.jsx';
import { Library } from './Library.jsx';
import { PostsWindow, AdsWindow } from './Activity.jsx';
import VehicleStep, { ClientPanel } from './VehicleStep.jsx';
import ScriptStep from './ScriptStep.jsx';
import VoiceStep from './VoiceStep.jsx';
import LookStep from './LookStep.jsx';
import GenerateStep from './GenerateStep.jsx';
import Videos from './Videos.jsx';
import { AdminMenu, ToolsMenu, ToolWindows } from './Tools.jsx';

const Studio = createContext(null);
export const useStudio = () => useContext(Studio);

export const GENERATING = ['preparing_references', 'submitting', 'queued', 'in_progress'];
const EMPTY_NARR = { previews: [], videos: [], lipsync: [] };

/**
 * A step's title bar with its Collapse / Expand toggle (the whole bar is clickable). A collapsed step shows only this
 * bar; what was typed or picked inside is kept.
 */
export function StepHead({ id, num, title, sub, aside }) {
  const s = useStudio();
  const open = !s.collapsed[id];
  const toggle = (e) => { if (e.target.closest('a, input, select, textarea, button:not(.step-toggle)')) return; s.toggleStep(id); };
  return (
    <div className="step-head step-head-toggle" onClick={toggle}>
      <span className="step-num">{num}</span>
      <div>{title}{sub}</div>
      {aside}
      <button type="button" className="step-toggle secondary small" aria-expanded={open} aria-label={(open ? 'Collapse ' : 'Expand ') + id}>
        {open ? 'Collapse ▴' : 'Expand ▾'}
      </button>
    </div>
  );
}
/**
 * End of a step without its own final button: a confirmation (check: what is confirmed, e.g. "Approved voice
 * selected") and Continue, which closes this step and opens the next. ready: false while the confirmation would not
 * be true yet; waiting: why, shown beside it.
 */
/**
 * State that belongs to the current client (a form field): each client keeps its own value, and switching clients
 * shows that client's value again. Values live for this page visit.
 */
export function useClientState(name, initial) {
  const s = useStudio();
  const [, rerender] = useState(0);
  const key = (s.clients.current ?? '') + '|' + name;
  const store = s.formStore.current;
  const value = Object.hasOwn(store, key) ? store[key] : initial;
  const set = useCallback((v) => { store[key] = typeof v === 'function' ? v(Object.hasOwn(store, key) ? store[key] : initial) : v; rerender((x) => x + 1); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set];
}

/** A step's contents, read-only for viewers (every control inside is disabled; links still work). */
export function Editable({ children }) {
  const s = useStudio();
  return <fieldset className="editable" disabled={s.readOnly}>{children}</fieldset>;
}

export function StepContinue({ from, to, label, check, ready = true, waiting = '' }) {
  const s = useStudio();
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(false); }, [s.chosen?.StockNumber, check]);
  useEffect(() => { if (!ready) setOk(false); }, [ready]);
  const go = () => {
    s.closeStep(from); s.openStep(to);
    setTimeout(() => document.getElementById(to)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };
  return (
    <div className="step-continue">
      {!ready && waiting && <span className="step-waiting">{waiting}</span>}
      <label className="check"><input type="checkbox" checked={ok} disabled={!ready} onChange={(e) => setOk(e.target.checked)} />{check}</label>
      <button type="button" disabled={!ready || !ok} onClick={go}>{label}</button>
    </div>
  );
}
// Steps open when the page loads: only step 1; the others open as the work reaches them.
const START_COLLAPSED = { stepScript: true, stepVoice: true, stepLook: true, stepGenerate: true, videos: true };

export default function App() {
  // Server data.
  const [clients, setClients] = useState({ items: [], current: null });
  const [inventory, setInventory] = useState(null);
  const [syncLog, setSyncLog] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [narr, setNarr] = useState(EMPTY_NARR);
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
  const [scenes, setScenes] = useState({ items: [], default: null });
  const [sceneId, setSceneId] = useState('');
  const [approvedVoice, setApprovedVoice] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [footage, setFootage] = useState(null);
  // Photo slideshow: the shapes built from one approved voice (one video each).
  const [shapes, setShapes] = useState(['instagram_reels', 'facebook_feed', 'youtube']);
  const [music, setMusic] = useState('');   // background track id ('' = none)
  const [background, setBackground] = useState('');   // showroom backdrop id ('' = original photos)
  const [adCut, setAdCut] = useState(false);   // slideshow for paid ads: no intro card, hero photos first
  const [approve, setApprove] = useState(false);
  const [confirmCurrent, setConfirmCurrent] = useState(false);
  const [resolution, setResolution] = useState('720p');
  const [captionJob, setCaptionJob] = useState(null);
  // The signed-in account (from the page) and what it may do.
  const me = boot.user ?? { email: '', role: 'viewer' };
  const isAdmin = me.role === 'admin', readOnly = me.role === 'viewer';
  const [noClients, setNoClients] = useState(false);
  const formStore = useRef({});   // per-client form values (useClientState, switchClient)
  // Tools: a dropdown in the top bar; each tool opens in a full-page window (null = none open).
  const [tool, setTool] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [postsOpen, setPostsOpen] = useState(false);
  const [adsOpen, setAdsOpen] = useState(false);
  // Collapsed steps: only step 1 is open when the page loads.
  const [collapsed, setCollapsed] = useState(START_COLLAPSED);
  const toggleStep = useCallback((id) => setCollapsed((c) => ({ ...c, [id]: !c[id] })), []);
  const openStep = useCallback((id) => setCollapsed((c) => (c[id] ? { ...c, [id]: false } : c)), []);
  const closeStep = useCallback((id) => setCollapsed((c) => (c[id] ? c : { ...c, [id]: true })), []);
  const stepClass = (id) => 'panel' + (collapsed[id] ? ' collapsed' : '');
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
    studio: useStatus('studio'), builder: useStatus('builder'), spokesperson: useStatus('spokesperson'), scenes: useStatus('scenes'), import: useStatus('import'),
  };
  const sayVehicle = statuses.vehicle[1];

  const client = clients.items.find((c) => c.id === clients.current) ?? null;

  // ---- Loaders ----------------------------------------------------------------------------------
  // Each client switch starts a new "generation": an answer to a request sent for the previous client is dropped,
  // so one client's voice previews, videos or cars never appear under another.
  const generation = useRef(0);
  const fresh = (fn) => async (...args) => { const g = generation.current; const r = await fn(...args); return g === generation.current ? r : undefined; };
  const loadClients = useCallback(async () => { const r = await api('clients'); setClients(r); return r; }, []);
  const loadInventory = useCallback(async () => {
    try { const r = await fresh(api)('inventory'); if (r) setInventory(r); } catch (e) { sayVehicle(e.message, true); }
  }, [sayVehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSyncLog = useCallback(async () => {
    try { const r = await fresh(api)('sync_log'); if (r) setSyncLog(r); } catch (e) { sayVehicle(e.message, true); }
  }, [sayVehicle]); // eslint-disable-line react-hooks/exhaustive-deps
  const sayVideos = statuses.videos[1];
  const loadJobs = useCallback(async () => {
    try { const r = await fresh(api)('jobs'); if (r) setJobs(r.map((x) => JSON.parse(x))); } catch (e) { sayVideos(e.message, true); }
  }, [sayVideos]); // eslint-disable-line react-hooks/exhaustive-deps
  const refreshNarrations = useCallback(async () => { const r = await fresh(api)('narration_list'); if (r) setNarr(r); return r ?? EMPTY_NARR; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saySpokesperson = statuses.spokesperson[1];
  const loadSpokespersons = useCallback(async () => {
    try { showSpokespersons(await api('spokesperson_list')); } catch (e) { saySpokesperson(e.message, true); }
  }, [saySpokesperson]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadScenes = useCallback(async () => {
    try { showScenes(await api('scene_list')); } catch (e) { statuses.scenes[1](e.message, true); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** A new background-setting library; keeps the current choice when it still exists, else the default. */
  function showScenes(lib, select = null) {
    setScenes(lib);
    setSceneId((keep) => select ?? (lib.items.some((x) => x.id === keep) ? keep : lib.default || ''));
  }

  /** A new spokesperson library; keeps the current choice when it still exists, else the default. */
  function showSpokespersons(lib, select = null) {
    setSpokespersons(lib);
    setSpokespersonId((keep) => select ?? (lib.items.some((s) => s.id === keep) ? keep : lib.default || ''));
  }

  /** Back to "no vehicle selected" (after a refresh or a client switch). */
  function clearVehicle() {
    setChosen(null); setScript(''); setSheetUrl(''); setApprove(false); setConfirmCurrent(false); setCaptionJob(null);
  }
  /**
   * Switch to another client without reloading the page: the current client's form is kept for when it is chosen
   * again, the lists are emptied at once, and the new client's form, cars, videos and voice previews are shown.
   * Approval tick boxes always start unticked.
   */
  async function switchClient(id) {
    const from = clients.current;
    if (from) formStore.current[from + '|app'] = { chosen, script, duration, voice, style, source, format, spokespersonId, sheetUrl, footage };
    generation.current++;
    setNarr(EMPTY_NARR); setJobs(null); setInventory(null); setSyncLog(null);
    setApprove(false); setConfirmCurrent(false); setCaptionJob(null);
    await api('client_select', { id });
    await loadClients();
    const f = formStore.current[id + '|app'] ?? {};
    setChosen(f.chosen ?? null); setScript(f.script ?? ''); setDurationRaw(f.duration ?? '30'); setVoiceRaw(f.voice ?? 'elevenlabs');
    setStyleRaw(f.style ?? 'showroom'); setSourceRaw(f.source ?? 'ai'); setFormat(f.format ?? 'instagram_reels');
    if (f.spokespersonId !== undefined) setSpokespersonId(f.spokespersonId);
    setSheetUrl(f.sheetUrl ?? ''); setFootage(f.footage ?? null);
    await Promise.all([loadInventory(), loadJobs(), loadSyncLog()]);
    refreshNarrations().catch((e) => statuses.studio[1](e.message, true));
  }

  useEffect(() => {
    loadSpokespersons();
    loadScenes();
    loadSyncLog();
    (async () => {
      try {
        const cl = await loadClients();
        if (!cl.items.length) { setNoClients(true); return; }
        await loadInventory(); await loadJobs();
      } catch (e) { sayVehicle(e.message, true); }
    })();
    refreshNarrations().catch(() => {});
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
  function setDuration(len) {
    setDurationRaw(len); defaultScript(len);
    // 60 seconds is made only as a photo slideshow (AI videos are 15 or 30 seconds).
    if (len === '60' && source === 'ai') setSource('slideshow');
  }
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
    // Footage and slideshows always use the approved ElevenLabs voice from step 3.
    if (s !== 'ai' && voice !== 'elevenlabs') setVoice('elevenlabs');
    if (s === 'ai' && duration === '60') setDuration('30');
  }

  const spokesperson = spokespersons.items.find((s) => s.id === spokespersonId) ?? null;
  const scene = scenes.items.find((x) => x.id === sceneId) ?? null;
  // Approved, ready previews for this car and length: the choices for step 3's "approved voice preview".
  const approvedPreviews = chosen ? narr.previews.filter((p) => p.approved && p.status === 'ready' && p.stock === chosen.StockNumber && String(p.duration) === duration) : [];
  useEffect(() => {
    setApprovedVoice((keep) => (approvedPreviews.some((p) => p.id === keep) ? keep : approvedPreviews[0]?.id ?? ''));
  }, [narr, chosen?.StockNumber, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const ctx = {
    me, isAdmin, readOnly,
    boot, client, clients, setClients, inventory, setInventory, syncLog, jobs, narr, spokespersons, spokesperson, scenes, scene, sceneId, setSceneId, showScenes,
    chosen, setChosen, duration, setDuration, script, setScript, voice, setVoice, style, setStyle, source, setSource,
    format, setFormat, spokespersonId, setSpokespersonId, approvedVoice, setApprovedVoice, approvedPreviews,
    sheetUrl, setSheetUrl, footage, setFootage, shapes, setShapes, music, setMusic, background, setBackground, adCut, setAdCut, approve, setApprove, confirmCurrent, setConfirmCurrent, resolution, setResolution,
    captionJob, setCaptionJob, tool, setTool, collapsed, toggleStep, openStep, closeStep, stepClass,
    busy, run, statuses, loadClients, loadInventory, loadJobs, loadSyncLog, refreshNarrations, showSpokespersons,
    clearVehicle, switchClient, formStore, defaultScript,
  };

  const signOut = async () => { try { await api('logout'); } finally { location.reload(); } };
  return (
    <Studio.Provider value={ctx}>
      <Popups />
      {/* Top bar, pinned while scrolling: Notifications, the Tools menu and Sign out. */}
      <div className="topbar">
        <span className="topbar-brand">{client ? client.name : 'Golden Auto'} · Video Studio</span>
        <div className="header-actions">
          <button type="button" className="secondary small" id="libraryOpen" aria-label="Video library" onClick={() => setLibraryOpen(true)}>▶<span className="label-long"> Library</span></button>
          {!readOnly && <button type="button" className="secondary small" id="postsOpen" aria-label="Posts" onClick={() => setPostsOpen(true)}>📣<span className="label-long"> Posts</span></button>}
          {!readOnly && <button type="button" className="secondary small" id="adsOpen" aria-label="Ads" onClick={() => setAdsOpen(true)}>💲<span className="label-long"> Ads</span></button>}
          {!readOnly && <ToolsMenu />}
          {isAdmin && <AdminMenu />}
          <AccountMenu onSignOut={signOut} />
          <Notifications />
        </div>
      </div>
      {boot.banner && <div className="staging-banner">{boot.banner}</div>}
      <header>
        <div>
          <span className="eyebrow">{client ? client.name.toUpperCase() : 'GOLDEN AUTO / SAN RAMON'}</span>
          <h1>Inventory → video</h1>
          <p>Pick a car, approve the words, generate. The final captioned video is built for you.</p>
        </div>
      </header>
      <nav className="steps" aria-label="Steps" onClick={(e) => { const a = e.target.closest('a[href^="#"]'); if (a) openStep(a.getAttribute('href').slice(1)); }}>
        <a href="#stepVehicle"><b>1</b> Vehicle</a><a href="#stepScript"><b>2</b> Script</a><a href="#stepVoice"><b>3</b> Voice</a>
        <a href="#stepLook"><b>4</b> Look</a><a href="#stepGenerate"><b>5</b> Generate</a><a href="#videos"><b>✓</b> Videos</a>
      </nav>
      <main>
        {readOnly && <p className="note-important view-only">View-only account: you can see the cars and download finished videos; ask an admin to make changes.</p>}
        {noClients ? <section className="panel"><h2>No clients yet</h2><p>No clients are assigned to your account yet. Ask an admin to give you access.</p></section> : <>
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
        </>}
      </main>
      <ToolWindows />
      <Library open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      <PostsWindow open={postsOpen} onClose={() => setPostsOpen(false)} />
      <AdsWindow open={adsOpen} onClose={() => setAdsOpen(false)} />
    </Studio.Provider>
  );
}
