import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const fixture = JSON.parse(readFileSync(new URL('./contracts/fastapi-v1.contract.json', import.meta.url), 'utf8'));
const canonical = (method, path) => `${method.toUpperCase()} ${path.replace(/:[^/]+|\{[^}]+\}/g, '{}')}`;

describe('FastAPI route surface parity', () => {
  it('registers every existing /api/v1 method and path', () => {
    const app = createApp({ prisma: {}, settings: {} });
    const actual = app.router.stack
      .filter((layer) => layer.route && layer.route.path.startsWith('/api/v1'))
      .flatMap((layer) => Object.keys(layer.route.methods).map((method) => canonical(method, layer.route.path)))
      .sort();
    const expected = fixture.operations.map((operation) => canonical(operation.method, operation.path)).sort();
    expect(actual).toEqual(expected);
  });
});
