/** What this device currently holds for one record or attachment. */
export interface LocalFact {
  key: string;
  payload: string;
  /** Milliseconds this device last wrote or accepted. 0 when it has no opinion yet. */
  clock: number;
  present: boolean;
}

/** What Jazz currently holds for the same key. */
export interface RemoteFact {
  key: string;
  payload: string;
  updatedAt: number;
  deleted: boolean;
}

export type SyncPlan =
  | { op: "upload"; key: string; updatedAt: number }
  | { op: "tombstone"; key: string; updatedAt: number }
  | { op: "download"; key: string; updatedAt: number }
  | { op: "remove-local"; key: string; updatedAt: number }
  | { op: "remember"; key: string; updatedAt: number };

/** Decide one action per key. A newer clock wins. Equal bytes are left in place. */
export function planSync(local: readonly LocalFact[], remote: readonly RemoteFact[], now: number): SyncPlan[] {
  const localByKey = new Map(local.map(item => [item.key, item]));
  const remoteByKey = new Map(remote.map(item => [item.key, item]));
  const plans: SyncPlan[] = [];
  for (const key of new Set([...localByKey.keys(), ...remoteByKey.keys()])) {
    const here = localByKey.get(key);
    const there = remoteByKey.get(key);
    const clock = here?.clock ?? 0;
    const present = here?.present ?? false;
    if (!there) {
      if (present) plans.push({ op: "upload", key, updatedAt: Math.max(clock, now) });
      continue;
    }
    if (present && !there.deleted && here!.payload === there.payload) {
      plans.push({ op: "remember", key, updatedAt: Math.max(clock, there.updatedAt) });
      continue;
    }
    if (clock > there.updatedAt) {
      plans.push(present
        ? { op: "upload", key, updatedAt: clock }
        : { op: "tombstone", key, updatedAt: clock });
      continue;
    }
    if (present && !there.deleted && clock === there.updatedAt && here!.payload !== there.payload && now > there.updatedAt) {
      plans.push({ op: "upload", key, updatedAt: now });
      continue;
    }
    if (there.deleted) {
      plans.push(present
        ? { op: "remove-local", key, updatedAt: there.updatedAt }
        : { op: "remember", key, updatedAt: there.updatedAt });
      continue;
    }
    plans.push({ op: "download", key, updatedAt: there.updatedAt });
  }
  return plans;
}
