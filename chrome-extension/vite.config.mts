import { resolve } from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import makeManifestPlugin from './plugins/make-manifest-plugin';
import { watchPublicPlugin, watchRebuildPlugin } from '@extension/hmr';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import libAssetsPlugin from '@laynezh/vite-plugin-lib-assets';
import { isDev, isProduction, watchOption } from '@extension/vite-config';

const rootDir = resolve(__dirname);
const srcDir = resolve(rootDir, 'src');
const outDir = resolve(rootDir, '..', 'dist');
const publicDir = resolve(rootDir, 'public');
export default defineConfig({
  resolve: {
    alias: {
      '@root': rootDir,
      '@src': srcDir,
      '@assets': resolve(srcDir, 'assets'),
    },
  },
  plugins: [
    libAssetsPlugin({
      outputPath: outDir,
    }) as PluginOption,
    watchPublicPlugin(),
    makeManifestPlugin({ outDir }),
    isDev && watchRebuildPlugin({ reload: true, id: 'chrome-extension-hmr' }),
    nodePolyfills({
      exclude: [],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
      protocolImports: true,
    }) as PluginOption,
  ],
  publicDir,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: isDev,
    minify: isProduction,
    reportCompressedSize: isProduction,
    watch: watchOption,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        inpage: resolve(__dirname, 'src/inpage/chuiProvider.ts'),
      },
      output: {
        entryFileNames(chunk) {
          if (chunk.name === 'background') return 'background.js';
          if (chunk.name === 'content') return 'content/index.js';
          if (chunk.name === 'inpage') return 'inpage/chuiProvider.js';
          return 'assets/[name].js';
        },
      },
      external: ['chrome'],
    },
  },
  envDir: '../',
});
