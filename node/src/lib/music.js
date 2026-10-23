// Background music for photo slideshows: a small library of tracks the dealer is licensed to use, uploaded by admins
// (state row "music": { items: [{ id, name, file, duration, created_at }] }, files in assets/music). A slideshow
// build may pick one; the final render mixes it quietly under the voice, ducked further while she speaks, looped
// when shorter than the video and faded out at the end (musicFilter). Nothing is downloaded or generated here.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { state, save } from './db.js';
import { str, toFloat, trim, gmdateC } from './text.js';

export const MUSIC_MAX_BYTES = 30 * 1024 * 1024;
const MUSIC_EXT = { mp3: 'mp3', m4a: 'm4a', aac: 'm4a', wav: 'wav' };
const musicDir = (cfg) => str(cfg.asset_dir ?? '') + '/music';
const library = (db) => state(db, 'music') ?? { items: [] };
const publicItem = (cfg, i) => ({ id: i.id, name: i.name, duration: i.duration, url: str(cfg.public_base_url ?? '').replace(/\/+$/, '') + '/assets/music/' + i.file });

/** ffprobe facts of an uploaded track: { duration, codec }; null when it has no audio we can read. */
export function musicProbe(cfg, path) {
  const ffprobe = str(cfg.ffprobe_path ?? dirname(str(cfg.ffmpeg_path ?? '/usr/bin/ffmpeg')) + '/ffprobe');
  const r = spawnSync(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 22, timeout: 60000 });
  let d = null; try { d = JSON.parse(r.stdout.toString()); } catch { return null; }
  const audio = (d?.streams ?? []).find((s) => s.codec_type === 'audio');
  return audio ? { duration: toFloat(d.format?.duration ?? audio.duration ?? 0), codec: str(audio.codec_name) } : null;
}

/** A track by id, with its file checked (null for '' = no music). */
export function musicFind(db, cfg, id) {
  if (str(id) === '') return null;
  const item = library(db).items.find((i) => i.id === id);
  if (!item) throw new Error('That music track was removed. Choose another or "No music".');
  const path = musicDir(cfg) + '/' + item.file;
  if (!/^music-[a-f0-9]{16}\.(mp3|m4a|wav)$/.test(item.file) || !existsSync(path)) throw new Error('The music file is missing. Upload it again.');
  return { ...item, path };
}

/** music_list (everyone), music_upload and music_delete (admins). */
export function musicApi(action, inp, cfg, db, files = {}, { probe = (p) => musicProbe(cfg, p), random = randomBytes } = {}) {
  const lib = library(db);
  if (action === 'music_upload') {
    const name = trim(str(inp.name ?? '').replace(/[\u0000-\u001f]/g, '')).slice(0, 60);
    if (name === '') throw new Error('Give the track a name.');
    const file = files.music ?? null;
    if (!file || file.error !== 0 || !existsSync(file.tmp_name)) throw new Error('Music upload failed. The file may be too large or the upload was interrupted.');
    if (file.size > MUSIC_MAX_BYTES) throw new Error('Music files must be 30 MB or smaller.');
    const ext = MUSIC_EXT[str(file.name ?? '').split('.').pop().toLowerCase()];
    if (!ext) throw new Error('Upload an MP3, M4A or WAV file.');
    const facts = probe(file.tmp_name);
    if (!facts) throw new Error('That file has no audio we can read. Upload an MP3, M4A or WAV file.');
    if (facts.duration < 10) throw new Error('The track is shorter than 10 seconds; it would repeat too often.');
    const dir = musicDir(cfg);
    try { mkdirSync(dir, { recursive: true, mode: 0o755 }); } catch { throw new Error('Cannot create the music folder.'); }
    const id = random(8).toString('hex'), stored = 'music-' + id + '.' + ext;
    try { copyFileSync(file.tmp_name, dir + '/' + stored); unlinkSync(file.tmp_name); } catch { throw new Error('Could not save the music file.'); }
    chmodSync(dir + '/' + stored, 0o644);
    lib.items.push({ id, name, file: stored, duration: Math.round(facts.duration * 10) / 10, created_at: gmdateC() });
    save(db, 'music', lib);
  } else if (action === 'music_delete') {
    const item = musicFind(db, cfg, str(inp.id ?? ''));
    if (!item) throw new Error('Choose a track to delete.');
    lib.items = lib.items.filter((i) => i.id !== item.id); save(db, 'music', lib);
    try { unlinkSync(item.path); } catch { /* already gone */ }
  } else if (action !== 'music_list') throw new Error('Unknown action.');
  return { items: lib.items.map((i) => publicItem(cfg, i)) };
}

// Music level: about -16 dB under the voice, ducked a further ~10 dB while she speaks; full level would fight the voice.
export const MUSIC_VOLUME = 0.16;

/**
 * The audio part of a render's filter graph with music: voice = the narration input (delayed by offsetMs), music =
 * the looped track input; output label [a]. The music fades in over 1 s and out over the last 2.5 s of the video.
 */
export function musicFilter(voiceIn, musicIn, offsetMs, total) {
  const fadeAt = Math.max(0, total - 2.5).toFixed(2);
  return `[${voiceIn}]aresample=44100,pan=stereo|c0=c0|c1=c0,adelay=${offsetMs}:all=1,apad,asplit=2[voice][key];` +
    `[${musicIn}]aformat=sample_rates=44100:channel_layouts=stereo,volume=${MUSIC_VOLUME},afade=t=in:d=1,afade=t=out:st=${fadeAt}:d=2.5[bed];` +
    '[bed][key]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=600[duck];' +
    '[voice][duck]amix=inputs=2:duration=first:normalize=0[a]';
}
