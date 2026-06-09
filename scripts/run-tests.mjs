import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const outdir = '.test-tmp';

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      results.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(full);
    }
  }
  return results;
}

const testFiles = findTestFiles('src');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const outFiles = [];
for (const file of testFiles) {
  const name = file.replace(/[/\\]/g, '__').replace(/\.ts$/, '.mjs');
  const outfile = join(outdir, name);
  await build({
    entryPoints: [file],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    sourcemap: 'inline',
    external: ['obsidian'],
  });
  outFiles.push(outfile);
}

const result = spawnSync(process.execPath, ['--test', ...outFiles], { stdio: 'inherit' });
await rm(outdir, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
