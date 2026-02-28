#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const checks = [
  { name: 'Unit Tests', command: 'npm', args: ['run', 'test:run'] },
  { name: 'Lint', command: 'npm', args: ['run', 'lint'] },
  { name: 'Build', command: 'npm', args: ['run', 'build'] },
];

const results = [];

for (const check of checks) {
  process.stdout.write(`\n[quality-gate] ${check.name}...\n`);

  const result = spawnSync(check.command, check.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const ok = result.status === 0;
  results.push({ name: check.name, ok });

  if (!ok) {
    process.stdout.write(`[quality-gate] ${check.name} failed\n`);
    break;
  }
}

const failed = results.find((r) => !r.ok);
process.stdout.write('\n[quality-gate] Summary\n');
for (const result of results) {
  process.stdout.write(`- ${result.name}: ${result.ok ? 'PASS' : 'FAIL'}\n`);
}

if (failed) {
  process.exit(1);
}

process.exit(0);

