// npm run migrate: applies pending database migrations (the server also does this when it starts).
import { loadEnvFile, loadConfig } from '../lib/config.js';
import { migrate } from '../lib/migrate.js';

loadEnvFile();
const applied = await migrate(loadConfig().databaseUrl);
console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
