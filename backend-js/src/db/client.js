import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaClient(
  connectionString = process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL,
) {
  if (!connectionString) {
    throw new Error("OUTPOST_DATABASE_URL or DATABASE_URL is required to create a Prisma client");
  }
  const normalized = connectionString.replace(/^postgresql\+psycopg:\/\//, "postgresql://");
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: normalized }),
  });
}
