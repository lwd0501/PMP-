import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const learningState=sqliteTable('learning_state',{
  userId:text('user_id').primaryKey().notNull(),
  revision:integer('revision').notNull().default(0),
  body:text('body').notNull(),
  updatedAt:integer('updated_at').notNull()
});
