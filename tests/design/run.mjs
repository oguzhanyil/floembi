import { build } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = await mkdtemp(join(tmpdir(), 'floem-design-test-'));
try {
  await build({ configFile: false, logLevel: 'warn', build: { outDir: dir, emptyOutDir: false, target: 'esnext',
    lib: { entry: resolve(import.meta.dirname, 'design.test.ts'), formats: ['es'], fileName: () => 'design.mjs' },
    rollupOptions: { external: ['node:assert/strict'] } } });
  await import(pathToFileURL(join(dir, 'design.mjs')).href);
} finally {
  const rel = relative(resolve(tmpdir()), resolve(dir));
  if (rel.startsWith('floem-design-test-') && !rel.includes('..') && !isAbsolute(rel)) await rm(dir, { recursive: true, force: true });
}
