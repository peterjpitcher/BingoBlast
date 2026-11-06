// Loaded by `npm test` (--import). The kit's server modules start with
// `import 'server-only'`, which throws everywhere except inside Next's server
// bundle. Node's test runner is neither, so this resolves that one package to
// an empty module, and nothing else. It changes no behaviour under test.
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'server-only') {
      return { url: 'data:text/javascript,export {};', shortCircuit: true, format: 'module' };
    }
    return nextResolve(specifier, context);
  },
});
