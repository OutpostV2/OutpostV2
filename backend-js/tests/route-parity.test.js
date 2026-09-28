import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const fixture = JSON.parse(readFileSync(new URL('./contracts/api-v1.contract.json', import.meta.url), 'utf8'));
const canonical = (method, path) => `${method.toUpperCase()} ${path.replace(/:[^/]+|\{[^}]+\}/g, '{}')}`;

describe('Frozen API route surface', () => {
  it('preserves every historical /api/v1 method and path while allowing new routes', () => {
    const app = createApp({ prisma: {}, settings: {} });
    const actual = app.router.stack
      .filter((layer) => layer.route && layer.route.path.startsWith('/api/v1'))
      .flatMap((layer) => Object.keys(layer.route.methods).map((method) => canonical(method, layer.route.path)))
      .sort();
    const expected = fixture.operations.map((operation) => canonical(operation.method, operation.path)).sort();
    expect(actual).toEqual(expect.arrayContaining(expected));
    expect(actual).toEqual(expect.arrayContaining([
      'GET /api/v1/organizations/{}',
      'GET /api/v1/organizations/{}/members',
      'PATCH /api/v1/organizations/{}/members/{}',
      'DELETE /api/v1/organizations/{}/members/{}',
      'POST /api/v1/organizations/{}/ownership-transfer',
      'GET /api/v1/organizations/{}/invitations',
      'POST /api/v1/organizations/{}/invitations',
      'DELETE /api/v1/organizations/{}/invitations/{}',
      'POST /api/v1/organization-invitations/accept',
    ]));
  });
});
