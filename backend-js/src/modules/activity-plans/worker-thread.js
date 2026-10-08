import { parentPort } from 'node:worker_threads';
import { extractActivityPlan } from './parser.js';

parentPort.once('message', async (bytes) => {
  try {
    const result = await extractActivityPlan(bytes);
    parentPort.postMessage({ ok: true, result });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      code: typeof error.code === 'string' ? error.code : 'pdf_processing_failed',
      message: typeof error.code === 'string' ? error.message : 'The PDF could not be processed.',
    });
  }
});
