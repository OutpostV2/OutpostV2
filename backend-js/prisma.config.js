import { readFileSync } from "node:fs";
import { defineConfig } from "prisma/config";

function legacyDatabaseUrl() {
  try {
    const contents = readFileSync(new URL("../backend/.env", import.meta.url), "utf8");
    const line = contents.split(/\r?\n/).find((item) => item.startsWith("OUTPOST_DATABASE_URL="));
    return line?.slice("OUTPOST_DATABASE_URL=".length);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const databaseUrl =
  process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL || legacyDatabaseUrl() || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl.replace(/^postgresql\+psycopg:\/\//, "postgresql://") },
});
