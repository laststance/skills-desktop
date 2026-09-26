/**
 * Public surface of the Unsplash gallery contract.
 *
 * Why it exists: the desktop app (main + renderer) and the website's `/api/rpc`
 * proxy must agree on one schema and one set of limits, so both import them
 * from this package instead of duplicating them.
 */
export * from './constants.ts'
export * from './contract.ts'
