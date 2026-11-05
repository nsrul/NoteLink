import "fake-indexeddb/auto";
import type { AccountStore } from "jazz-tools";
import { startLocalJazzServer } from "jazz-tools/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../jazz/schema";
import permissions from "../jazz/permissions";
import { restoreBackup } from "./backup";
import { openNotebookSync } from "./jazz-sync";
import { writeFile } from "./local-files";
import { Plane } from "./plane";
import { readFiles, readRecords } from "./storage";

const emptyBackup = () => ({ format: "open-notes" as const, version: 1 as const, createdAt: new Date().toISOString(), records: [], files: [] });

function memoryAccountStore(): AccountStore {
  let value: string | null = null;
  return {
    async read() { return value; },
    async update(transform) { value = transform(value); },
  };
}

describe("Jazz notebook sync", { timeout: 60_000 }, () => {
  let server: Awaited<ReturnType<typeof startLocalJazzServer>>;

  beforeAll(async () => {
    server = await startLocalJazzServer({
      inMemory: true,
      allowLocalFirstAuth: true,
      schema: app,
      permissions,
    });
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
  });

  beforeEach(async () => {
    await restoreBackup(emptyBackup());
  });

  async function open(secret?: string) {
    const sync = await openNotebookSync({
      appId: server.appId,
      serverUrl: server.url,
      env: "dev",
      store: memoryAccountStore(),
      driver: { type: "memory" },
      durability: "global",
      persistClocks: false,
      ...(secret ? { secret } : {}),
    });
    await sync.ready;
    return sync;
  }

  it("copies a committed record and attachment to the same account only", async () => {
    const first = await open();
    const plane = await Plane.open();
    await plane.write({ action: "put", collection: "workspace_settings", id: "preferences", value: { theme: "dark" } });
    await writeFile("photos/dot.bin", new Blob([new Uint8Array([1, 2, 3])], { type: "application/octet-stream" }));
    await first.flush();
    await plane.close();
    const secret = first.secret();
    await first.stop();
    await restoreBackup(emptyBackup());

    const stranger = await open();
    await stranger.flush();
    expect(await readRecords()).toEqual([]);
    expect(await readFiles()).toEqual([]);
    await stranger.stop();

    const second = await open(secret);
    await vi.waitFor(async () => {
      await second.flush();
      expect(await readRecords()).toEqual([
        expect.objectContaining({ scope: "personal", collection: "workspace_settings", id: "preferences", value: { theme: "dark" } }),
      ]);
      const files = await readFiles();
      expect(files.map(file => file.key)).toEqual(["personal\nphotos/dot.bin"]);
      expect(new Uint8Array(await files[0]!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    }, { timeout: 20_000, interval: 250 });
    await second.stop();
  });

  it("propagates a deletion to the same account", async () => {
    const first = await open();
    const plane = await Plane.open();
    await plane.write({ action: "put", collection: "workspace_settings", id: "roots", value: { roots: ["a"] } });
    await first.flush();
    await plane.write({ action: "delete", collection: "workspace_settings", id: "roots" });
    await first.flush();
    const secret = first.secret();
    await plane.close();
    await first.stop();
    await restoreBackup(emptyBackup());

    const second = await open(secret);
    await vi.waitFor(async () => {
      await second.flush();
      const rows = await readRecords();
      expect(rows.some(row => row.id === "roots")).toBe(false);
    }, { timeout: 20_000, interval: 250 });
    await second.stop();
  });
});
