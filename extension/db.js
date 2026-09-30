// Tiny IndexedDB store used to hand the stitched image from the service worker to the viewer tab.
const DB_NAME = 'clean-capture';
const STORE = 'shots';
const KEEP = 5;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export async function saveShot(record) {
  const db = await openDb();
  const keys = await new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).getAllKeys();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  keys.sort().slice(0, Math.max(0, keys.length - (KEEP - 1))).forEach((k) => store.delete(k));
  store.put(record, record.id);
  await done(tx);
  db.close();
}

export async function loadShot(id) {
  const db = await openDb();
  const rec = await new Promise((resolve, reject) => {
    const r = db.transaction(STORE).objectStore(STORE).get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return rec;
}
