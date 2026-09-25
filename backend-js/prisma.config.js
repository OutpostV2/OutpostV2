import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const envFile = fileURLToPath(new URL(".env", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);

const databaseUrl = process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL || "";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl.replace(/^postgresql\+psycopg:\/\//, "postgresql://") },
});
