// Clients and inventory actions for the session's selected client (ctx.client; client_select is in server.js).
import { clientsLoad, clientFind, clientAdd, clientReanalyze, clientSaveDetails, clientDetails, clientInventoryKey } from '../lib/clients.js';
import { state } from '../lib/db.js';
import { syncInventory } from '../lib/website.js';

const withDetails = (c) => ({ ...c, script_details: clientDetails(c) });

export const clientRoutes = {
  clients: ({ db, client }) => ({ items: clientsLoad(db).items.map(withDetails), current: client }),
  client_add: async ({ db, body }) => ({ client: await clientAdd(db, String(body.name ?? ''), String(body.website ?? '')) }),
  client_analyze: async ({ db, body, client }) => ({ client: withDetails(await clientReanalyze(db, String(body.id ?? client))) }),
  client_details: ({ db, body, client }) => ({ client: withDetails(clientSaveDetails(db, client, body)) }),
  inventory: ({ db, client }) => { clientFind(db, client); return state(db, clientInventoryKey(client)) ?? { vehicles: [] }; },
  // Refresh inventory: Golden Auto's website reader, or the website import for Dealer Car Search clients.
  sync: ({ db, cfg, client }) => syncInventory(db, cfg, client),
};
