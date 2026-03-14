import {
  pgTable,
  serial,
  bigint,
  varchar,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
  username: varchar("username", { length: 255 }),
  firstName: varchar("first_name", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  profile: jsonb("profile").default({}).$type<Record<string, unknown>>(),
  llmProvider: varchar("llm_provider", { length: 50 }).default("claude").notNull(),
  llmModel: varchar("llm_model", { length: 100 }).default("claude-sonnet-4-20250514").notNull(),
  language: varchar("language", { length: 50 }).default("english").notNull(),
});

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("messages_user_id_idx").on(table.userId)]
);

export const memories = pgTable(
  "memories",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id)
      .notNull(),
    content: text("content").notNull(),
    category: varchar("category", { length: 50 }).notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("memories_user_id_idx").on(table.userId)]
);
