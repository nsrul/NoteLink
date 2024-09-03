import { schema as s } from "jazz-tools";
import { app } from "./schema";

/** Each account reads and writes only the rows it created.
 *  An update is judged on the existing row. The replacement does not have to
 *  carry the creator column, so a later tombstone is allowed. */
export default s.definePermissions(app, ({ policy, session, allOf }) => {
  const mine = { $createdBy: session.user };
  const unchanged = allOf([]);
  policy.notes_records.allowRead.where(mine);
  policy.notes_records.allowInsert.always();
  policy.notes_records.allowUpdate.whereOld(mine).whereNew(unchanged);
  policy.notes_records.allowDelete.where(mine);
  policy.notes_files.allowRead.where(mine);
  policy.notes_files.allowInsert.always();
  policy.notes_files.allowUpdate.whereOld(mine).whereNew(unchanged);
  policy.notes_files.allowDelete.where(mine);
});
