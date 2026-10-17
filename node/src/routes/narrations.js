// Voice previews and lip-sync actions (narration_*), same JSON in and out as the PHP dashboard. The selected client
// comes from the PHP session (ctx.client), exactly as public/index.php passes it to narrationApi.
import { narrationApi } from '../lib/narrations.js';

const ACTIONS = ['narration_voices', 'narration_list', 'narration_preview', 'narration_approve', 'narration_lipsync', 'narration_poll', 'narration_delete', 'narration_lipsync_delete'];
export const narrationRoutes = Object.fromEntries(ACTIONS.map((a) => [a, ({ cfg, db, client, body }) => narrationApi(a, { ...body, client }, cfg, db)]));
