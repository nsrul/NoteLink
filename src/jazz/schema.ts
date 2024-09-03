import { schema as s } from "jazz-tools";

/** The notebook's records and attachments, one row per local key.
 *  `updated_at` is milliseconds as text. `deleted` is a tombstone so a
 *  removal on one device is not filled back in from another device's copy. */
export const app = s.defineApp({
  notes_records: s.table({
    scope: s.string(),
    collection: s.string(),
    record_id: s.string(),
    value: s.json(),
    updated_at: s.string(),
    deleted: s.boolean(),
  }, {}),
  notes_files: s.table({
    file_key: s.string(),
    media_type: s.string(),
    bytes: s.bytes(),
    updated_at: s.string(),
    deleted: s.boolean(),
  }, {}),
});
