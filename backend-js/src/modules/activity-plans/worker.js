import { Worker } from 'node:worker_threads';
import { Prisma } from '@prisma/client';

const PARSE_TIMEOUT_MS = 30_000;

function parseInWorker(bytes, timeoutMs = PARSE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-thread.js', import.meta.url), {
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish({
      code: 'pdf_timeout', message: 'PDF extraction exceeded the 30-second limit.',
    }), timeoutMs);
    worker.once('message', (message) => {
      if (message.ok) finish(null, message.result);
      else finish({ code: message.code, message: message.message });
    });
    worker.once('error', () => finish({
      code: 'pdf_processing_failed', message: 'The PDF could not be processed.',
    }));
    worker.once('exit', (code) => {
      if (code !== 0) finish({
        code: 'pdf_processing_failed', message: 'The PDF processor stopped unexpectedly.',
      });
    });
    worker.postMessage(new Uint8Array(bytes));
  });
}

export async function recoverInterruptedPlans(prisma) {
  return prisma.activityPlan.updateMany({
    where: { status: 'extracting' },
    data: {
      status: 'failed', processingStartedAt: null, revision: { increment: 1 },
      failure: { code: 'processing_interrupted', message: 'Processing was interrupted. Retry this plan.' },
      updatedAt: new Date(),
    },
  });
}

export async function processQueuedPlan(prisma, storage) {
  const candidate = await prisma.activityPlan.findFirst({
    where: { status: 'queued' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!candidate) return null;
  const claimed = await prisma.activityPlan.updateMany({
    where: { id: candidate.id, status: 'queued' },
    data: { status: 'extracting', processingStartedAt: new Date(), updatedAt: new Date() },
  });
  if (!claimed.count) return null;
  try {
    const bytes = await storage.getSource(candidate.objectKey);
    const result = await parseInWorker(bytes);
    await prisma.activityPlan.update({
      where: { id: candidate.id },
      data: {
        status: 'ready', pageCount: result.page_count,
        pages: result.pages, proposal: result.proposal,
        reviewItems: result.review_items, warnings: result.warnings,
        failure: Prisma.DbNull, processingStartedAt: null,
        revision: { increment: 1 }, updatedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.activityPlan.update({
      where: { id: candidate.id },
      data: {
        status: 'failed', processingStartedAt: null,
        failure: {
          code: typeof error.code === 'string' ? error.code : 'pdf_processing_failed',
          message: typeof error.code === 'string' ? error.message : 'The PDF could not be processed.',
        },
        revision: { increment: 1 }, updatedAt: new Date(),
      },
    });
  }
  return candidate.id;
}

export function startActivityPlanWorker(prisma, storage, { intervalMs = 1_000 } = {}) {
  let stopped = false;
  let running = false;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      await processQueuedPlan(prisma, storage);
    } catch (error) {
      console.error('activity_plan.worker_failed', { message: error.message });
    } finally {
      running = false;
    }
  };
  const ready = recoverInterruptedPlans(prisma).then(() => tick()).catch((error) => {
    console.error('activity_plan.recovery_failed', { message: error.message });
  });
  const timer = setInterval(() => { void ready.then(() => tick()); }, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await ready;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  };
}
