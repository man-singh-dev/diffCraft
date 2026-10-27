import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
//session depends on user so we need to import user first
export const users = pgTable(
  'users',
  {
    //UUIDv4 IDs rae random and not guessable, so they are safe to expose in URLs. They are also
    //more efficient than serial integers for large tables, because they don't require a global
    //lock to generate the next ID. --- IGNORE ---
    //UUIDv7 IDs are time-ordered, so they are more efficient than UUIDv4 for large tables, because
    //they don't require a global lock to generate the next ID. --- IGNORE ---
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // Case-insensitive uniqueness: "A@x.com" and "a@x.com" can't both exist.
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert; //data accepted when new user enters
