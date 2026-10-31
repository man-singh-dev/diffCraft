import { sql } from 'drizzle-orm';

/** `'a', 'b'` for a CHECK constraint. Only for constants, never user input: values are inlined. */
export const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));
