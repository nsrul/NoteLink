import { describe, expect, it } from "vitest";
import { planSync, type LocalFact, type RemoteFact } from "./jazz-plan";

const local = (key: string, payload: string, clock = 0, present = true): LocalFact => ({ key, payload, clock, present });
const remote = (key: string, payload: string, updatedAt: number, deleted = false): RemoteFact => ({ key, payload, updatedAt, deleted });

describe("Jazz sync plan", () => {
  it("uploads a local row the server has never seen", () => {
    expect(planSync([local("page", "a")], [], 50)).toEqual([{ op: "upload", key: "page", updatedAt: 50 }]);
  });

  it("downloads a remote row this device does not have", () => {
    expect(planSync([], [remote("page", "a", 40)], 50)).toEqual([{ op: "download", key: "page", updatedAt: 40 }]);
  });

  it("keeps equal copies and remembers the newer clock", () => {
    expect(planSync([local("page", "a", 10)], [remote("page", "a", 40)], 50)).toEqual([{ op: "remember", key: "page", updatedAt: 40 }]);
  });

  it("lets the newer clock win when the copies differ", () => {
    expect(planSync([local("page", "local", 80)], [remote("page", "remote", 40)], 90)).toEqual([{ op: "upload", key: "page", updatedAt: 80 }]);
    expect(planSync([local("page", "local", 10)], [remote("page", "remote", 40)], 90)).toEqual([{ op: "download", key: "page", updatedAt: 40 }]);
  });

  it("removes a local row when a newer tombstone arrives", () => {
    expect(planSync([local("page", "a", 10)], [remote("page", "a", 40, true)], 90)).toEqual([{ op: "remove-local", key: "page", updatedAt: 40 }]);
  });

  it("sends a tombstone when this device deleted the row more recently", () => {
    expect(planSync([local("page", "", 80, false)], [remote("page", "a", 40)], 90)).toEqual([{ op: "tombstone", key: "page", updatedAt: 80 }]);
  });

  it("does not resurrect a row both sides have already deleted", () => {
    expect(planSync([local("page", "", 40, false)], [remote("page", "", 40, true)], 90)).toEqual([{ op: "remember", key: "page", updatedAt: 40 }]);
  });
});
