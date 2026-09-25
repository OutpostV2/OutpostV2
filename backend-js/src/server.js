import { loadSettings } from './core/config.js';
import { createPrismaClient } from './db/client.js';
import { createApp } from './app.js';
import { createValkeyClient } from './core/valkey.js';

const settings = loadSettings();
const prisma = createPrismaClient(settings.databaseUrl);
const redisClient = createValkeyClient(settings.valkeyUrl);
const app = createApp({ prisma, settings, redisClient });
const port = Number(process.env.PORT || 8000);
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => {
  console.info(`Outpost API listening at http://${host}:${port}`);
});

async function shutdown() {
  server.close();
  await redisClient.close();
  await prisma.$disconnect();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
