// Print a bcrypt hash for a new dashboard password, for "password_hash" in private/config.json:
//   node src/cli/password-hash.js        (asks for the password; it is not shown or saved)
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = (s) => { if (!rl.muted) process.stdout.write(s); };
rl.question('New dashboard password: ', (pw) => {
  rl.close(); process.stdout.write('\n');
  if (pw.length < 12) { console.error('Use at least 12 characters.'); process.exit(1); }
  console.log(bcrypt.hashSync(pw, 12));
});
rl.muted = true;
