const Module = require('node:module')

const legacyTypescriptEntry = require.resolve('typescript6')
const originalResolveFilename = Module._resolveFilename

/**
 * Routes JS-API tooling to TypeScript 6 when a preloaded lint/docgen process resolves TypeScript.
 * @param {string} request - The module request being resolved.
 * @param {NodeModule | undefined} parent - The module that requested the dependency.
 * @param {boolean} isMain - Whether Node is resolving the process entrypoint.
 * @param {import('node:module').RequireResolveOptions | undefined} options - Optional Node resolution settings.
 * @returns {string} The resolved module entrypoint path.
 * @example
 * // With NODE_OPTIONS=--require=./scripts/use-legacy-typescript-js-api.cjs:
 * require.resolve('typescript') // => require.resolve('typescript6')
 * require.resolve('typescript/lib/tsserverlibrary') // => require.resolve('typescript6/lib/tsserverlibrary')
 */
Module._resolveFilename = function resolveLegacyTypescriptApi(
  request,
  parent,
  isMain,
  options,
) {
  // Older tools call the removed JS API through require('typescript').
  if (request === 'typescript') {
    return legacyTypescriptEntry
  }

  // Some typed lint services import compiler internals via TypeScript subpaths.
  if (request.startsWith('typescript/')) {
    return originalResolveFilename.call(
      this,
      request.replace('typescript/', 'typescript6/'),
      parent,
      isMain,
      options,
    )
  }

  // All other packages keep Node's normal resolution behavior.
  return originalResolveFilename.call(this, request, parent, isMain, options)
}
