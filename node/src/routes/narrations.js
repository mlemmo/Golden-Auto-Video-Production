// Voice previews and lip-sync actions (narration_*) for the session's selected client (ctx.client).
import { narrationApi } from '../lib/narrations.js';

const ACTIONS = ['narration_voices', 'narration_list', 'narration_preview', 'narration_approve', 'narration_lipsync', 'narration_poll', 'narration_delete', 'narration_lipsync_delete'];
export const narrationRoutes = Object.fromEntries(ACTIONS.map((a) => [a, ({ cfg, db, client, body }) => narrationApi(a, { ...body, client }, cfg, db)]));
