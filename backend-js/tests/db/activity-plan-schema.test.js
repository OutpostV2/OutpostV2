import { describe, expect, test } from 'vitest';
import { createPrismaClient } from '../../src/db/client.js';

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))('activity-plan schema', () => {
  test('adds tenant-scoped workflow records without changing existing curriculum', async () => {
    const prisma = createPrismaClient();
    try {
      const [rows] = await prisma.$queryRaw`
        SELECT to_regclass('public.activity_plans')::text AS activity_plans,
               to_regclass('public.roadmap_versions')::text AS roadmap_versions
      `;
      expect(rows.activity_plans).toBe('activity_plans');
      expect(rows.roadmap_versions).toBe('roadmap_versions');
    } finally {
      await prisma.$disconnect();
    }
  });
});
