import { eq } from "drizzle-orm";
import { users } from "@/server/db/schema";
import type { Database } from "@/server/db/types";

export async function userExistsWithEmail(db: Database, email: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return row !== undefined;
}
