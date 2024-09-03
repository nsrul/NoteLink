import { createAccountManager, createDb, exportLocalFirstSecret, ReadTier, type AccountStore, type Db, type DurabilityTier, type JsonValue } from "jazz-tools";
import { app } from "../jazz/schema";
import { planSync, type LocalFact, type RemoteFact } from "./jazz-plan";
import { commitLocalEdits, onChange, readFiles, readRecords, type StoredFile, type StoredRecord } from "./storage";

const CLOCK_KEY = "open-notes-jazz-clocks";

export interface JazzSyncOptions {
  appId: string;
  serverUrl: string;
  env?: string;
  /** Restore this local-first account instead of creating or reloading one. */
  secret?: string;
  store?: AccountStore;
  driver?: { type: "memory" } | { type: "persistent"; dbName?: string };
  /** Wait until writes reach this tier before the sync call returns. */
  durability?: DurabilityTier;
  clocks?: Map<string, number>;
  persistClocks?: boolean;
}

export interface NotebookSync {
  flush(): Promise<void>;
  stop(): Promise<void>;
  /** Local-first signing secret for this account. Another device restores it to share the notebook. */
  secret(): string;
  readonly ready: Promise<void>;
}

interface LiveRow {
  key: string;
  payload: string;
  updatedAt: number;
  deleted: boolean;
  kind: "record" | "file";
  record?: StoredRecord;
  file?: StoredFile;
  signature?: string;
}

/** Public cloud settings, when the build was given them. Secrets are never read here. */
export function jazzCloudConfig(): Pick<JazzSyncOptions, "appId" | "serverUrl" | "env"> | null {
  const appId = import.meta.env.VITE_JAZZ_APP_ID?.trim();
  const serverUrl = import.meta.env.VITE_JAZZ_SERVER_URL?.trim();
  if (!appId || !serverUrl) return null;
  return { appId, serverUrl, env: "prod" };
}

let appSync: Promise<NotebookSync | null> | undefined;

/** One sync session for this page. Missing cloud settings leave the notebook local. */
export function startAppJazzSync(): Promise<NotebookSync | null> {
  const config = jazzCloudConfig();
  if (!config) return Promise.resolve(null);
  return appSync ??= openNotebookSync(config).catch(error => {
    appSync = undefined;
    throw error;
  });
}

export async function openNotebookSync(options: JazzSyncOptions): Promise<NotebookSync> {
  const env = options.env ?? "prod";
  const accounts = await createAccountManager({
    appId: options.appId,
    serverUrl: options.serverUrl,
    env,
    ...(options.store ? { store: options.store } : {}),
  });
  const existing = options.secret ? undefined : accounts.getLoggedIn();
  const account = existing ?? (options.secret ? accounts.restoreLocalFirst(options.secret) : accounts.createLocalFirst());
  const secret = exportLocalFirstSecret(account);
  const db = await createDb({
    appId: options.appId,
    serverUrl: options.serverUrl,
    account,
    env,
    driver: options.driver ?? { type: "persistent" },
  });
  const durability = options.durability ?? "local";
  const clocks = options.clocks ?? loadClocks(options.persistClocks !== false);
  const persistClocks = options.persistClocks !== false;
  return bindSync({ db, secret, clocks, persistClocks, durability });
}

function bindSync(input: {
  db: Db;
  secret: string;
  clocks: Map<string, number>;
  persistClocks: boolean;
  durability: DurabilityTier;
}): NotebookSync {
  const { db, clocks } = input;
  let stopped = false;
  let applying = false;
  let rerun = false;
  let chain: Promise<void> = Promise.resolve();
  let primed = false;
  let snapshot = new Map<string, string>();
  const rejected = new Map<string, string>();
  const readTier = { tier: ReadTier.LocalFirstUnlessEmpty } as const;

  const unsubscribeRecords = db.subscribe(app.notes_records, () => kick(), readTier);
  const unsubscribeFiles = db.subscribe(app.notes_files, () => kick(), readTier);
  const stopLocal = onChange(() => {
    if (applying) rerun = true;
    else kick();
  });

  function kick(): Promise<void> {
    if (stopped) return chain;
    rerun = true;
    chain = chain.then(async () => {
      while (rerun && !stopped) {
        rerun = false;
        try {
          await reconcile();
        } catch (error) {
          console.error("Jazz sync failed", error);
        }
      }
    }).catch(error => {
      console.error("Jazz sync failed", error);
    });
    return chain;
  }

  async function reconcile(): Promise<void> {
    const now = Date.now();
    const [records, files] = await Promise.all([readRecords(), readFiles()]);
    const localPayloads = new Map<string, string>();
    for (const row of records) localPayloads.set(recordKey(row), stable(row.value));
    for (const file of files) localPayloads.set(fileKey(file.key), await filePayload(file));
    if (primed) {
      for (const [key, payload] of localPayloads) {
        const before = snapshot.get(key);
        if (before === undefined || before !== payload) clocks.set(key, now);
      }
      for (const key of snapshot.keys()) {
        if (!localPayloads.has(key)) clocks.set(key, now);
      }
    } else primed = true;

    const local: LocalFact[] = [];
    const seen = new Set<string>();
    for (const [key, payload] of localPayloads) {
      seen.add(key);
      local.push({ key, payload, clock: clocks.get(key) ?? 0, present: true });
    }
    for (const [key, clock] of clocks) {
      if (!seen.has(key)) local.push({ key, payload: "", clock, present: false });
    }
    const [recordRows, fileRows] = await Promise.all([
      db.all(app.notes_records, readTier),
      db.all(app.notes_files, readTier),
    ]);
    const remoteRows = [...recordRows.map(row => recordLive(row)), ...fileRows.map(row => fileLive(row))];
    const remoteByKey = new Map(remoteRows.map(row => [row.key, row]));
    const remote: RemoteFact[] = remoteRows.map(row => ({
      key: row.key, payload: row.payload, updatedAt: row.updatedAt, deleted: row.deleted,
    }));
    const plans = planSync(local, remote, now);
    const recordPuts: StoredRecord[] = [];
    const recordDeletes: { scope: string; collection: string; id: string }[] = [];
    const filePuts: StoredFile[] = [];
    const fileDeletes: string[] = [];
    const uploads: LiveRow[] = [];

    for (const plan of plans) {
      const found = remoteByKey.get(plan.key);
      if (plan.op === "remember") clocks.set(plan.key, plan.updatedAt);
      else if (plan.op === "download" && found?.record) {
        recordPuts.push(found.record);
        clocks.set(plan.key, plan.updatedAt);
      } else if (plan.op === "download" && found?.file && !found.deleted) {
        filePuts.push(found.file);
        clocks.set(plan.key, plan.updatedAt);
      } else if (plan.op === "remove-local") {
        const record = parseRecordKey(plan.key);
        if (record) recordDeletes.push(record);
        else fileDeletes.push(parseFileKey(plan.key));
        clocks.set(plan.key, plan.updatedAt);
      } else if (plan.op === "upload" || plan.op === "tombstone") {
        const signature = `${plan.op}:${plan.updatedAt}`;
        if (rejected.get(plan.key) === signature) continue;
        const row = await liveForUpload(plan.key, plan.updatedAt, plan.op === "tombstone", records, files);
        if (row) uploads.push({ ...row, signature });
        clocks.set(plan.key, plan.updatedAt);
      }
    }

    applying = true;
    try {
      await commitLocalEdits({ recordPuts, recordDeletes, filePuts, fileDeletes });
      for (const row of uploads) {
        try {
          await pushRow(db, row, input.durability);
          rejected.delete(row.key);
        } catch (error) {
          rejected.set(row.key, row.signature ?? "");
          console.error("Jazz sync failed", error);
        }
      }
    } finally {
      applying = false;
    }
    if (uploads.length || recordPuts.length || recordDeletes.length || filePuts.length || fileDeletes.length) {
      const [nextRecords, nextFiles] = await Promise.all([readRecords(), readFiles()]);
      snapshot = new Map<string, string>();
      for (const row of nextRecords) snapshot.set(recordKey(row), stable(row.value));
      for (const file of nextFiles) snapshot.set(fileKey(file.key), await filePayload(file));
    } else {
      snapshot = localPayloads;
    }
    if (input.persistClocks) saveClocks(clocks);
  }

  const ready = kick();
  return {
    ready,
    flush: () => kick(),
    secret: () => input.secret,
    async stop() {
      stopped = true;
      unsubscribeRecords();
      unsubscribeFiles();
      stopLocal();
      await db.shutdown();
    },
  };
}

async function pushRow(db: Db, row: LiveRow, durability: DurabilityTier): Promise<void> {
  const updated_at = String(row.updatedAt);
  if (row.kind === "record" && row.record) {
    await db.upsert(app.notes_records, await syncRowId(row.key), {
      scope: row.record.scope,
      collection: row.record.collection,
      record_id: row.record.id,
      value: jsonValue(row.record.value) as JsonValue,
      updated_at,
      deleted: row.deleted,
    }).wait({ tier: durability });
    return;
  }
  if (row.kind === "file" && row.file) {
    const bytes = row.deleted ? new Uint8Array() : new Uint8Array(await row.file.blob.arrayBuffer());
    await db.upsert(app.notes_files, await syncRowId(row.key), {
      file_key: row.file.key,
      media_type: row.file.blob.type,
      bytes,
      updated_at,
      deleted: row.deleted,
    }).wait({ tier: durability });
  }
}

async function liveForUpload(key: string, updatedAt: number, deleted: boolean, records: StoredRecord[], files: StoredFile[]): Promise<LiveRow | null> {
  const recordId = parseRecordKey(key);
  if (recordId) {
    const value = records.find(row => row.scope === recordId.scope && row.collection === recordId.collection && row.id === recordId.id)?.value ?? {};
    const record = { ...recordId, value };
    return { key, payload: stable(value), updatedAt, deleted, kind: "record", record };
  }
  const fileKeyValue = parseFileKey(key);
  const file = files.find(item => item.key === fileKeyValue) ?? { key: fileKeyValue, blob: new Blob([]) };
  return { key, payload: deleted ? "" : await filePayload(file), updatedAt, deleted, kind: "file", file };
}

function recordLive(row: { scope: string; collection: string; record_id: string; value: unknown; updated_at: string; deleted: boolean }): LiveRow {
  const value = isRecord(row.value) ? row.value : {};
  const record: StoredRecord = { scope: row.scope, collection: row.collection, id: row.record_id, value };
  return {
    key: recordKey(record),
    payload: stable(value),
    updatedAt: Number(row.updated_at) || 0,
    deleted: row.deleted,
    kind: "record",
    record,
  };
}

function fileLive(row: { file_key: string; media_type: string; bytes: Uint8Array; updated_at: string; deleted: boolean }): LiveRow {
  const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array();
  const blob = new Blob([Uint8Array.from(bytes)], { type: row.media_type });
  const file = { key: row.file_key, blob };
  return {
    key: fileKey(row.file_key),
    payload: row.deleted ? "" : filePayloadSync(bytes, row.media_type),
    updatedAt: Number(row.updated_at) || 0,
    deleted: row.deleted,
    kind: "file",
    file,
  };
}

function recordKey(row: { scope: string; collection: string; id: string }): string {
  return `record\u0000${row.scope}\u0000${row.collection}\u0000${row.id}`;
}
function parseRecordKey(key: string): { scope: string; collection: string; id: string } | null {
  const [kind, scope, collection, id] = key.split("\u0000");
  if (kind !== "record" || !scope || !collection || !id) return null;
  return { scope, collection, id };
}
function fileKey(key: string): string { return `file\u0000${key}`; }
function parseFileKey(key: string): string { return key.startsWith("file\u0000") ? key.slice(5) : key; }

async function filePayload(file: StoredFile): Promise<string> {
  return filePayloadSync(new Uint8Array(await file.blob.arrayBuffer()), file.blob.type);
}
function filePayloadSync(bytes: Uint8Array, mediaType: string): string {
  return `${mediaType}\n${bytesToBase64(bytes)}`;
}
function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}

/** A stable UUID for one local key, so a repeated upload updates the same Jazz row. */
export async function syncRowId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`open-notes:${key}`));
  const bytes = new Uint8Array(digest).slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function jsonValue(value: Record<string, unknown>): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function loadClocks(persist: boolean): Map<string, number> {
  if (!persist || typeof localStorage === "undefined") return new Map();
  try {
    const parsed = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? "{}") as Record<string, unknown>;
    return new Map(Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
  } catch {
    return new Map();
  }
}
function saveClocks(clocks: Map<string, number>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(CLOCK_KEY, JSON.stringify(Object.fromEntries(clocks)));
}
