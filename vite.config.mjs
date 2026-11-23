// The block demo's build: index.html at the top of dist, every path relative, nothing from other hosts.
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
	root: here,
	base: './',
	publicDir: false,
	resolve: {
		alias: [{ find: /^patch-block$/, replacement: fileURLToPath(new URL('./lib/patch-block.js', import.meta.url)) }],
		dedupe: ['three'],
	},
	// The generator and the light bake run in a module worker (src/build-worker.js).
	worker: { format: 'es' },
	build: { target: 'es2022', outDir: `${here}docs`, emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 4000, modulePreload: { polyfill: false } },
};
