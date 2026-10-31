import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const PARSE_TIMEOUT_MS = 30_000;
const STALE_EXTRACTION_MS = PARSE_TIMEOUT_MS + 15_000;

export function parseInWorker(bytes, timeoutMs = PARSE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker-thread.js', import.meta.url), {
      // Do not inherit --watch or test-runner loader flags into parser threads.
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    let done = false;
    const finish = async (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      await worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish({
      code: 'pdf_timeout', message: 'PDF extraction exceeded the 30-second limit.',
    }), timeoutMs);
    worker.on('message', (message) => {
      // Node's development watcher also sends dependency notifications through
      // worker ports. They are not parser results and must not end the job.
      if (message?.ok === true) finish(null, message.result);
      else if (message?.ok === false) finish({ code: message.code, message: message.message });
    });
    worker.once('error', () => finish({
      code: 'pdf_processing_failed', message: 'The PDF could not be processed.',
    }));
    worker.once('exit', (code) => {
      if (!done) finish({
        code: 'pdf_processing_failed', message: 'The PDF processor stopped unexpectedly.',
      });
    });
    worker.postMessage(new Uint8Array(bytes));
  });
}

export async function recoverInterruptedPlans(prisma) {
  return prisma.activityPlan.updateMany({
    where: { status: 'extracting', OR: [
      { processingStartedAt: null },
      { processingStartedAt: { lte: new Date(Date.now() - STALE_EXTRACTION_MS) } },
    ] },
    data: {
      status: 'failed', processingStartedAt: null, revision: { increment: 1 },
      failure: { code: 'processing_interrupted', message: 'Processing was interrupted. Retry this plan.' },
      updatedAt: new Date(),
    },
  });
}

export async function processQueuedPlan(prisma, storage) {
  // The transaction owns only a PostgreSQL advisory lock. Workflow changes use
  // separate committed statements so a crash leaves a durable extracting row.
  // A second server cannot parse a different plan concurrently with this one.
  return prisma.$transaction(async (lease) => {
    const [lock] = await lease.$queryRaw`SELECT pg_try_advisory_xact_lock(724001963) AS acquired`;
    if (!lock.acquired) return null;
    await recoverInterruptedPlans(prisma);
    return processClaimedPlan(prisma, storage);
  }, { timeout: 45_000 });
}

async function sourceBytes(storage, key) {
  let timer;
  try {
    return await Promise.race([
      storage.getSource(key),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Source read timed out')), 10_000);
      }),
    ]);
  } catch {
    throw { code: 'pdf_source_unavailable', message: 'Source PDF is temporarily unavailable. Retry this plan.' };
  } finally { clearTimeout(timer); }
}

async function processClaimedPlan(prisma, storage) {
  const candidate = await prisma.activityPlan.findFirst({
    where: { status: 'queued' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  if (!candidate) return null;
  const startedAt = new Date();
  const claimed = await prisma.activityPlan.updateMany({
    where: { id: candidate.id, status: 'queued', revision: candidate.revision },
    data: { status: 'extracting', processingStartedAt: startedAt, revision: { increment: 1 }, updatedAt: startedAt },
  });
  if (!claimed.count) return null;
  const claimedState = { id: candidate.id, status: 'extracting', processingStartedAt: startedAt, revision: candidate.revision + 1 };
  try {
    const bytes = await sourceBytes(storage, candidate.objectKey);
    if (bytes.length !== candidate.byteCount || createHash('sha256').update(bytes).digest('hex') !== candidate.sha256) {
      throw { code: 'pdf_source_changed', message: 'Source PDF no longer matches the upload. Upload the original PDF again.' };
    }
    const result = await parseInWorker(bytes);
    await prisma.activityPlan.updateMany({
      where: claimedState,
      data: {
        status: 'ready', pageCount: result.page_count,
        pages: result.pages, proposal: result.proposal,
        reviewItems: result.review_items, warnings: result.warnings,
        failure: Prisma.DbNull, processingStartedAt: null,
        revision: { increment: 1 }, updatedAt: new Date(),
      },
    });
  } catch (error) {
    await prisma.activityPlan.updateMany({
      where: claimedState,
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
      console.error('activity_plan.worker_failed');
    } finally {
      running = false;
    }
  };
  const ready = tick();
  const timer = setInterval(() => { void ready.then(() => tick()); }, intervalMs);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await ready;
    while (running) await new Promise((resolve) => setTimeout(resolve, 20));
  };
}
