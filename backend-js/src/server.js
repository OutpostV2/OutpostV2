import { loadSettings } from './core/config.js';
import { createPrismaClient } from './db/client.js';
import { createApp } from './app.js';
import { createValkeyClient } from './core/valkey.js';
import { createObjectStorage } from './modules/activity-plans/storage.js';
import { startActivityPlanWorker } from './modules/activity-plans/worker.js';

const settings = loadSettings();
const prisma = createPrismaClient(settings.databaseUrl);
const redisClient = createValkeyClient(settings.valkeyUrl);
const objectStorage = settings.objectStorage ? createObjectStorage(settings.objectStorage) : null;
if (objectStorage) await objectStorage.ensureBucket({ createIfMissing: settings.env === 'development' || settings.env === 'test' });
const app = createApp({ prisma, settings, redisClient, objectStorage });
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.info(`Outpost API listening at http://${host}:${port}`);
});
const stopActivityPlanWorker = objectStorage
  ? startActivityPlanWorker(prisma, objectStorage) : async () => {};

async function shutdown() {
  server.close();
  await stopActivityPlanWorker();
  await objectStorage?.close();
  await redisClient.close();
  await prisma.$disconnect();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
