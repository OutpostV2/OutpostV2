import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../tests/contracts/fastapi-v1.contract.json', import.meta.url), 'utf8'));
const unknownId = '00000000-0000-4000-8000-000000000000';
const differences = [];
let checked = 0;
for (const operation of fixture.operations) {
  if (operation.path === '/api/v1/auth/google/authorize') continue;
  const path = operation.path.replace(/\{[^}]+\}/g, unknownId);
  const init = { method: operation.method, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(5000) };
  if (!['GET', 'HEAD'].includes(operation.method)) init.body = '{}';
  const [python, node] = await Promise.all([
    fetch('http://127.0.0.1:8001' + path, init),
    fetch('http://127.0.0.1:8000' + path, init),
  ]);
  checked += 1;
  const result = { method: operation.method, path, python: python.status, node: node.status };
  if (python.status !== node.status) differences.push(result);
}
console.log(JSON.stringify({ checked, differences }, null, 2));
if (differences.length) process.exitCode = 1;
