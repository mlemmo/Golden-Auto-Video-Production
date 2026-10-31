// npm run create-user -- --email you@example.com --name "Your Name" [--staff]
// Creates an account; the password is typed at a hidden prompt (twice), never on the command line.
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { loadEnvFile, loadConfig } from '../lib/config.js';
import { createPool } from '../lib/db.js';
import { createUser } from '../lib/users.js';

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string', default: '' }, staff: { type: 'boolean', default: false } } });
if (!values.email) {
  console.error('Usage: npm run create-user -- --email you@example.com --name "Your Name" [--staff]');
  process.exit(1);
}
const password = await askHidden('Password (at least 10 characters): ');
if (password !== await askHidden('Same password again: ')) {
  console.error('The passwords did not match. Nothing was created.');
  process.exit(1);
}
loadEnvFile();
const pool = createPool(loadConfig().databaseUrl);
try {
  const id = await createUser(pool, { email: values.email, name: values.name, password, isStaff: values.staff });
  console.log(`Created account ${id} for ${values.email}${values.staff ? ' (eShield staff)' : ''}.`);
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
