import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/lambda/api-handler.ts', 'src/lambda/pipeline-handler.ts'],
  outdir: 'dist',
  entryNames: '[name]',
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['@aws-sdk/*'],
});
