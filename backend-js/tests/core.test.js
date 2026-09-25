import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const prisma = { $queryRaw: async () => [{ '?column?': 1 }] };

describe('core API contract', () => {
  it('reports liveness and a trusted request ID', async () => {
    const response = await request(createApp({ prisma }))
      .get('/health')
      .set('X-Request-ID', 'untrusted');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'healthy' });
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
    expect(response.headers['x-request-id']).not.toBe('untrusted');
  });

  it('reports database readiness and the API version', async () => {
    expect((await request(createApp({ prisma })).get('/ready')).body).toEqual({ status: 'ready' });
    expect((await request(createApp({ prisma })).get('/api/v1')).body).toEqual({ name: 'Outpost API', version: 'v1' });
  });

  it('hides database errors behind the stable error envelope', async () => {
    const unavailable = { $queryRaw: async () => { throw new Error('database password leak'); } };
    const response = await request(createApp({ prisma: unavailable })).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({ code: 'not_ready', message: 'Database is unavailable' });
    expect(JSON.stringify(response.body)).not.toContain('password leak');
  });

  it('returns a stable 404 envelope', async () => {
    const response = await request(createApp({ prisma })).get('/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error).toMatchObject({ code: 'not_found' });
    expect(response.body.error.request_id).toBe(response.headers['x-request-id']);
  });
});
