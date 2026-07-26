// ---------------------------------------------------------------------
// Simple JSON-file-backed data store.
//
// WHY THIS INSTEAD OF A REAL DATABASE:
// This avoids requiring you to provision and configure a separate
// database server (like Postgres) just to get started. It is genuinely
// fine for a single small shop's order volume (dozens to low hundreds
// of orders/day). Writes are serialized with a file lock to prevent
// two requests from corrupting the file at the same time.
//
// WHEN TO UPGRADE:
// If order volume grows significantly, or you need multiple backend
// server instances running at once (horizontal scaling), migrate this
// to Postgres/MySQL. The functions below (getAll, getById, insert,
// update) are intentionally the only data-access surface used by the
// rest of the app, so swapping the implementation later only requires
// rewriting this one file.
// ---------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function filePathFor(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function ensureFile(collection) {
  const fp = filePathFor(collection);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, '[]', 'utf8');
  return fp;
}

async function withLock(collection, fn) {
  const fp = ensureFile(collection);
  let release;
  try {
    release = await lockfile.lock(fp, { retries: { retries: 20, minTimeout: 25, maxTimeout: 200 } });
    const raw = fs.readFileSync(fp, 'utf8');
    const items = raw.trim() ? JSON.parse(raw) : [];
    const result = await fn(items);
    fs.writeFileSync(fp, JSON.stringify(items, null, 2), 'utf8');
    return result;
  } finally {
    if (release) await release();
  }
}

async function getAll(collection) {
  const fp = ensureFile(collection);
  const raw = fs.readFileSync(fp, 'utf8');
  return raw.trim() ? JSON.parse(raw) : [];
}

async function getById(collection, id, idField = 'id') {
  const items = await getAll(collection);
  return items.find((i) => i[idField] === id) || null;
}

async function getOne(collection, predicate) {
  const items = await getAll(collection);
  return items.find(predicate) || null;
}

async function insert(collection, doc) {
  return withLock(collection, async (items) => {
    items.push(doc);
    return doc;
  });
}

async function update(collection, id, patchFn, idField = 'id') {
  return withLock(collection, async (items) => {
    const idx = items.findIndex((i) => i[idField] === id);
    if (idx === -1) return null;
    items[idx] = { ...items[idx], ...patchFn(items[idx]) };
    return items[idx];
  });
}

module.exports = { getAll, getById, getOne, insert, update };
