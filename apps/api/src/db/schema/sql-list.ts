import { sql } from 'drizzle-orm';

/** Only for constants, never user input: values are inlined. */
export const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));
