// 简单迁移执行器：按文件名顺序执行 drizzle/ 下生成的 SQL 迁移（幂等记录于 _migrations 表）。
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../drizzle");

async function main() {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migrations (name text primary key, applied_at timestamptz default now())`);
  let files: string[] = [];
  try {
    files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("no migrations directory yet — run `pnpm db:generate` first");
    return;
  }
  for (const f of files) {
    const r = await pool.query(`SELECT 1 FROM _migrations WHERE name=$1`, [f]);
    if (r.rowCount) continue;
    const sql = await readFile(path.join(migrationsDir, f), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO _migrations(name) VALUES($1)`, [f]);
      await client.query("COMMIT");
      console.log("applied", f);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  console.log("migrations up to date");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
