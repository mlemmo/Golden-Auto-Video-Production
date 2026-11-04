// What a customer chooses with an order besides the video type and length: the spokesperson and background setting of
// an AI video, the background of a slideshow's outside photos, where they will post it and the video shapes. The
// choices come from the studio's own libraries (spokespersons, background settings, showroom backdrops), so "Open in
// studio" can select them. Paid extras (AI showroom pictures) are not offered here.
import { HttpError } from '../lib/auth.js';
import { spokespersonLibrary, spokespersonPublic } from '../lib/spokespersons.js';
import { sceneLibrary } from '../lib/scenes.js';
import { backdropApi, backdropsAvailable } from '../lib/backdrops.js';

export const PLATFORMS = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', youtube: 'YouTube' };
// Studio format ids. An AI video is one paid render per shape, so it gets one; a slideshow builds every shape ticked.
export const FORMATS = {
  instagram_reels: { name: 'Vertical 9:16', hint: 'Reels, Stories, TikTok, Shorts', ai: true },
  facebook_feed: { name: 'Feed 4:5', hint: 'Facebook and Instagram feed', ai: true },
  square: { name: 'Square 1:1', hint: 'Feed posts', ai: true },
  youtube: { name: 'Wide 16:9', hint: 'YouTube, websites', ai: false },
};
// The shapes suggested for each platform (the customer can change them).
export const PLATFORM_FORMATS = { instagram: ['instagram_reels', 'facebook_feed'], facebook: ['instagram_reels', 'facebook_feed'], tiktok: ['instagram_reels'], youtube: ['youtube'] };

/** The choices offered on the order form. */
export function orderChoices(db, cfg) {
  const people = spokespersonLibrary(db, cfg), scenes = sceneLibrary(db);
  const backdrops = backdropsAvailable(cfg) ? backdropApi('backdrop_list', {}, cfg, db) : null;
  return {
    spokespersons: people.items.map((i) => { const p = spokespersonPublic(i, cfg); return { id: p.id, name: p.name, url: p.url }; }),
    default_spokesperson: people.default ?? people.items[0]?.id ?? null,
    scenes: scenes.items.map((s) => ({ id: s.id, name: s.name })),
    default_scene: scenes.default ?? scenes.items[0]?.id ?? null,
    backdrops: [{ id: '', name: 'Original photos' }, ...(backdrops ? [...backdrops.builtin, ...backdrops.items.map((i) => ({ id: i.id, name: 'Showroom — ' + i.name, url: i.url }))] : [])],
    platforms: PLATFORMS, formats: FORMATS, platform_formats: PLATFORM_FORMATS,
  };
}

/** The order's choices, checked against what is offered. product: 'ai_video' | 'slideshow'. */
export function cleanChoices(db, cfg, product, input = {}) {
  const offer = orderChoices(db, cfg);
  const platforms = [...new Set((Array.isArray(input.platforms) ? input.platforms : []).map(String))];
  if (platforms.some((p) => !PLATFORMS[p])) throw new HttpError(400, 'Choose where the video will be posted from the list.');
  const formats = [...new Set((Array.isArray(input.formats) ? input.formats : []).map(String))];
  if (!formats.length) throw new HttpError(400, 'Choose at least one video shape.');
  if (formats.some((f) => !FORMATS[f])) throw new HttpError(400, 'Choose the video shapes from the list.');
  if (product === 'ai_video') {
    if (formats.length > 1) throw new HttpError(400, 'An AI video is made in one shape. Choose one, or order another video for a second shape.');
    if (!FORMATS[formats[0]].ai) throw new HttpError(400, `An AI video cannot be made ${FORMATS[formats[0]].name}. Choose vertical, feed or square.`);
    const spokesperson = String(input.spokesperson ?? '') || offer.default_spokesperson;
    if (!offer.spokespersons.some((s) => s.id === spokesperson)) throw new HttpError(400, 'Choose a spokesperson from the list.');
    const scene = String(input.scene ?? '') || offer.default_scene;
    if (!offer.scenes.some((s) => s.id === scene)) throw new HttpError(400, 'Choose a background setting from the list.');
    return { spokesperson, scene, platforms, formats };
  }
  const background = String(input.background ?? '');
  if (!offer.backdrops.some((b) => b.id === background)) throw new HttpError(400, 'Choose a background from the list.');
  return { background, platforms, formats };
}

/** Names of an order's choices for display: { spokesperson, scene, background, platforms, formats } as text. */
export function choiceNames(db, cfg, c) {
  if (!c) return null;
  const offer = orderChoices(db, cfg);
  const name = (list, id) => list.find((x) => x.id === id)?.name ?? (id ? 'removed' : null);
  return {
    spokesperson: c.spokesperson ? name(offer.spokespersons, c.spokesperson) : null,
    scene: c.scene ? name(offer.scenes, c.scene) : null,
    background: c.background !== undefined ? name(offer.backdrops, c.background) : null,
    platforms: (c.platforms ?? []).map((p) => PLATFORMS[p] ?? p),
    formats: (c.formats ?? []).map((f) => FORMATS[f]?.name ?? f),
  };
}
