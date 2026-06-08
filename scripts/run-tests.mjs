import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const outdir = '.test-tmp';
const outfile = `${outdir}/homepageRoots.test.mjs`;

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

await build({
  entryPoints: ['src/homepageRoots.test.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  sourcemap: 'inline',
});

const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
await rm(outdir, { recursive: true, force: true });

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
