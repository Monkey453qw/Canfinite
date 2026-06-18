/**
 * IndexedDB persistence for auto-save and session restore.
 *
 * Stores a single document ("canvas") with:
 *  - objects: array of Stroke/TextObject/SolverBox
 *  - viewport: { x, y, scale }
 *  - savedAt: timestamp
 *
 * Save is debounced — we only flush after ~500ms of quiescence to avoid
 * hammering IndexedDB during continuous drawing.
 */

const DB_NAME = "infinite-canvas";
const DB_VERSION = 1;
const STORE_NAME = "documents";
const DOC_ID = "default";

interface PersistedDoc {
  id: string;
  objects: unknown[];
  viewport: { x: number; y: number; scale: number };
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function saveDocument(
  objects: unknown[],
  viewport: { x: number; y: number; scale: number },
): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const doc: PersistedDoc = {
        id: DOC_ID,
        objects,
        viewport,
        savedAt: Date.now(),
      };
      store.put(doc);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // Silent fail — persistence is best-effort
    console.warn("Canvas save failed:", e);
  }
}

export async function loadDocument(): Promise<PersistedDoc | null> {
  try {
    const db = await openDB();
    return await new Promise<PersistedDoc | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DOC_ID);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn("Canvas load failed:", e);
    return null;
  }
}

/** Debounced auto-save wrapper. */
export function createDebouncedSaver(delay = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPromise: Promise<void> = Promise.resolve();
  return (
    objects: unknown[],
    viewport: { x: number; y: number; scale: number },
  ) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      lastPromise = saveDocument(objects, viewport);
    }, delay);
    return lastPromise;
  };
}
