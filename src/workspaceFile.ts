const DB_NAME = "flores-finance-workspace-file";
const STORE = "handles";
const RECORD_KEY = "workspace-json";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
  });
}

export async function idbGetWorkspaceFileHandle(): Promise<FileSystemFileHandle | null> {
  try {
    const db = await openDb();
    return await new Promise<FileSystemFileHandle | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(RECORD_KEY);
      let value: FileSystemFileHandle | null = null;
      req.onsuccess = () => {
        value = (req.result as FileSystemFileHandle | undefined) ?? null;
      };
      req.onerror = () => reject(req.error ?? new Error("idb get failed"));
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("idb transaction failed"));
      };
      tx.onabort = () => {
        db.close();
        reject(new Error("idb transaction aborted"));
      };
    });
  } catch {
    return null;
  }
}

export async function idbSetWorkspaceFileHandle(handle: FileSystemFileHandle): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(handle, RECORD_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("idb put failed"));
      tx.onabort = () => reject(tx.error ?? new Error("idb put aborted"));
    });
  } finally {
    db.close();
  }
}

export async function idbClearWorkspaceFileHandle(): Promise<void> {
  try {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("idb delete failed"));
        tx.onabort = () => reject(tx.error ?? new Error("idb delete aborted"));
      });
    } finally {
      db.close();
    }
  } catch {
    /* ignore */
  }
}

export async function workspaceFileReadText(handle: FileSystemFileHandle): Promise<string> {
  const file = await handle.getFile();
  return file.text();
}

export async function workspaceFileWriteText(
  handle: FileSystemFileHandle,
  text: string,
): Promise<void> {
  const writable = await handle.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close().catch(() => {});
  }
}

export async function workspaceFileRequestReadWrite(handle: FileSystemFileHandle): Promise<void> {
  const opts: FileSystemHandlePermissionDescriptor = { mode: "readwrite" };
  if (!("queryPermission" in handle) || typeof handle.queryPermission !== "function") return;
  let status = await handle.queryPermission(opts);
  if (status === "denied") throw new Error("Permission denied for workspace file.");
  if (status === "prompt" && "requestPermission" in handle && typeof handle.requestPermission === "function") {
    status = await handle.requestPermission(opts);
  }
  if (status !== "granted") throw new Error("Read/write access to the workspace file was not granted.");
}

export function isWorkspaceFileApiAvailable(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.isSecureContext) return false;
  return (
    typeof window.showOpenFilePicker === "function" &&
    typeof window.showSaveFilePicker === "function"
  );
}
