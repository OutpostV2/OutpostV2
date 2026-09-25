import { describe, expect, test } from "vitest";
import { createPrismaClient } from "../../src/db/client.js";

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))("Prisma compatibility with Alembic schema", () => {
  test("reads users and learning tables in a read-only transaction", async () => {
    const client = createPrismaClient();
    try {
      await client.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
        const [userCount, organizationCount, topicCount, reviewCount] =
          await Promise.all([
            tx.user.count(),
            tx.organization.count(),
            tx.topic.count(),
            tx.reviewTopicProgress.count(),
          ]);
        for (const count of [userCount, organizationCount, topicCount, reviewCount]) {
          expect(Number.isInteger(count)).toBe(true);
        }
        if (userCount > 0) {
          const user = await tx.user.findFirst({
            select: { id: true, displayName: true, accountType: true },
          });
          expect(user?.displayName).toEqual(expect.any(String));
          expect(user?.id).toEqual(expect.any(String));
        }
      });
    } finally {
      await client.$disconnect();
    }
  });
});
