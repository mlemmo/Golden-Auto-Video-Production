// Starts the portal: reads .env, connects to MySQL, applies pending migrations, listens on PORT.
import { loadEnvFile, loadConfig } from './lib/config.js';
import { createPool } from './lib/db.js';
import { migrate } from './lib/migrate.js';
import { createApp } from './app.js';

loadEnvFile();
const config = loadConfig();
const applied = await migrate(config.databaseUrl);
if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
const pool = createPool(config.databaseUrl);
const app = createApp({ pool, config });
app.listen(config.port, config.host, () => console.log(`LotSpotlight portal listening on ${config.host ?? '*'}:${config.port}`));
