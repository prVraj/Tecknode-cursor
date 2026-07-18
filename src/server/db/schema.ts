import type { user } from "./models/auth.model";

export * from "./models";

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
