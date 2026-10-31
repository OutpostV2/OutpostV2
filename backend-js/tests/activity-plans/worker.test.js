import { expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
const mocked = vi.hoisted(() => ({ factory: null }));
vi.mock('node:worker_threads', async (original) => {
  const actual = await original();
  return { ...actual, Worker: class {
    constructor(...args) { return mocked.factory ? mocked.factory(...args) : new actual.Worker(...args); }
  } };
});
import * as workers from '../../src/modules/activity-plans/worker.js';

test('terminates isolated extraction within its time budget', async () => {
  expect(typeof workers.parseInWorker).toBe('function');
  await expect(workers.parseInWorker(Buffer.from('%PDF-1.7\ninvalid'), 1))
    .rejects.toMatchObject({ code: 'pdf_timeout' });
});

test('isolated parser reports malformed input without an exception trace', async () => {
  expect(typeof workers.parseInWorker).toBe('function');
  await expect(workers.parseInWorker(Buffer.from('%PDF-1.7\ninvalid')))
    .rejects.toEqual({ code: 'pdf_invalid', message: 'The PDF could not be read.' });
});

test('ignores Node watch dependency messages before the extraction result', async () => {
  const fake = new EventEmitter();
  fake.terminate = vi.fn();
  fake.postMessage = () => {
    queueMicrotask(() => {
      fake.emit('message', { 'watch:import': ['file:///worker-thread.js'] });
      fake.emit('message', { ok: true, result: { page_count: 1 } });
    });
  };
  mocked.factory = () => fake;
  try {
    await expect(workers.parseInWorker(Buffer.from('%PDF-test'))).resolves.toEqual({ page_count: 1 });
  } finally { mocked.factory = null; }
});
