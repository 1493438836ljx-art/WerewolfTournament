import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://wt:wt_dev_password@localhost:5432/werewolf",
  max: 10,
});

export const db = drizzle(pool, { schema });
export { schema };
