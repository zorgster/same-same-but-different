/* ============================================================
   GENE ANNOTATION CACHE (IndexedDB)

   Stores Ensembl lookup + genomic sequence per gene symbol so repeat
   lookups are instant. IndexedDB rather than localStorage: a gene with
   many transcripts plus its sequence can exceed localStorage's ~5 MB.
   Every operation fails soft (private windows, blocked storage) —
   callers fall back to Ensembl.
============================================================ */

const DB_NAME = "ssbd-fastq-gene-finder";
const STORE = "genes";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    dbPromise = null; // allow a later retry
    throw err;
  });
  return dbPromise;
}

export function geneCacheKey(species, symbol) {
  return `${species}:${String(symbol).trim().toUpperCase()}`;
}

// Returns { key, lookupJson, maskedSeq, cachedAt } or null.
export async function getCachedGene(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function putCachedGene(key, lookupJson, maskedSeq) {
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, lookupJson, maskedSeq, cachedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore — caching is best-effort
  }
}
