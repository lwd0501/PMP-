import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
export const learningState = sqliteTable("learning_state", {
  userId: text("user_id").primaryKey().notNull(),
  revision: integer("revision").notNull().default(0),
  body: text("body").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const learningStateChunks = sqliteTable(
  "learning_state_chunks",
  {
    userId: text("user_id").notNull(),
    chunkId: text("chunk_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.chunkId] })],
);
