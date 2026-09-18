import { defineConfig } from 'tsup';

export default defineConfig({
  entryPoints: ['src/index.ts', 'src/cli.ts'],
  format: ['cjs', 'esm'],
  dts: { entry: 'src/index.ts' },
  outDir: 'dist',
  clean: true,
  target: 'node18',
  platform: 'node',
  external: ['typescript'],
});
