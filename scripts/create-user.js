// Usage:
//   node scripts/create-user.js admin
//   node scripts/create-user.js courier
// Prompts for a username and password, hashes the password, and stores
// the account. There is deliberately no public signup endpoint for
// admin/courier accounts — they are only ever created this way, by
// someone with direct access to the server.

require('dotenv').config();
const readline = require('readline');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/db');
const { hashPassword } = require('../src/auth');

const role = process.argv[2];
if (!['admin', 'courier'].includes(role)) {
  console.error('Usage: node scripts/create-user.js <admin|courier>');
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

(async () => {
  const username = (await ask('Username: ')).trim();
  const password = (await ask('Password (min 10 characters): ')).trim();
  const name = (await ask('Display name (e.g. courier\'s real name): ')).trim();
  rl.close();

  if (username.length < 3 || password.length < 10) {
    console.error('Username must be 3+ chars and password 10+ chars.');
    process.exit(1);
  }

  const existing = await db.getOne('users', (u) => u.username === username);
  if (existing) {
    console.error('A user with that username already exists.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);
  const user = {
    id: uuidv4(),
    username,
    passwordHash,
    role,
    name,
    createdAt: new Date().toISOString()
  };
  await db.insert('users', user);
  console.log(`Created ${role} account "${username}".`);
})();
