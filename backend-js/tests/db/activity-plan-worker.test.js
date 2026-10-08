import { randomUUID, createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { createPrismaClient } from '../../src/db/client.js';
import { createObjectStorage, sourceKey } from '../../src/modules/activity-plans/storage.js';

async function validPdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage();
  page.drawText('Module 1: Foundations', { x: 40, y: 700, font });
  page.drawText('Week 1: Orientation', { x: 40, y: 680, font });
  page.drawText('1. Set goals', { x: 40, y: 660, font });
  return Buffer.from(await document.save());
}

describe.skipIf(!process.env.OUTPOST_DATABASE_URL || !process.env.OUTPOST_OBJECT_ACCESS_KEY)(
  'durable activity-plan worker', () => {
    test('claims once, preserves source, and recovers an interrupted extraction', async () => {
      const { processQueuedPlan, recoverInterruptedPlans } =
        await import('../../src/modules/activity-plans/worker.js');
      const prisma = createPrismaClient();
      const storage = createObjectStorage({
        endpoint: process.env.OUTPOST_OBJECT_ENDPOINT,
        bucket: process.env.OUTPOST_OBJECT_BUCKET,
        accessKey: process.env.OUTPOST_OBJECT_ACCESS_KEY,
        secretKey: process.env.OUTPOST_OBJECT_SECRET_KEY,
      });
      const suffix = randomUUID().replaceAll('-', '');
      const user = await prisma.user.create({ data: { displayName: 'Worker Test', username: `worker_${suffix}`, accountType: 'coordinator' } });
      const organization = await prisma.organization.create({ data: { name: 'Worker Test', slug: `worker-${suffix}` } });
      const keys = [];
      try {
        await storage.ensureBucket();
        const bytes = await validPdf();
        const id = randomUUID();
        const key = sourceKey(organization.id, id);
        keys.push(key);
        await storage.putSource(key, bytes);
        await prisma.activityPlan.create({ data: {
          id, organizationId: organization.id, uploadedBy: user.id,
          name: 'Plan', filename: 'plan.pdf', objectKey: key,
          sha256: createHash('sha256').update(bytes).digest('hex'), byteCount: bytes.length,
        } });
        const claimed = await processQueuedPlan(prisma, storage);
        expect(claimed).toBe(id);
        expect(await processQueuedPlan(prisma, storage)).toBeNull();
        const ready = await prisma.activityPlan.findUnique({ where: { id } });
        expect(ready.status).toBe('ready');
        expect(ready.pages[0].text).toContain('Set goals');
        expect(ready.proposal.phases[0].weeks[0].topics[0].title).toBe('Set goals');
        expect(await storage.getSource(key)).toEqual(bytes);

        await prisma.activityPlan.update({ where: { id }, data: { status: 'extracting' } });
        await recoverInterruptedPlans(prisma);
        const recovered = await prisma.activityPlan.findUnique({ where: { id } });
        expect(recovered.status).toBe('failed');
        expect(recovered.failure.code).toBe('processing_interrupted');
      } finally {
        await prisma.activityPlan.deleteMany({ where: { organizationId: organization.id } });
        for (const key of keys) await storage.deleteSource(key);
        await prisma.organization.delete({ where: { id: organization.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.$disconnect();
        await storage.close();
      }
    }, 45_000);
  });
