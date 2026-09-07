/** Public gallery endpoints use bounded network and payload work per request. */
export const UNSPLASH_REQUEST_TIMEOUT_MS = 10_000
export const UNSPLASH_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const UNSPLASH_MAX_REQUEST_BYTES = 8 * 1024
export const UNSPLASH_MAX_REQUEST_URL_LENGTH = 8 * 1024
export const UNSPLASH_CORS_MAX_AGE_SECONDS = 600
export const UNSPLASH_RETRY_MAX_SECONDS = 86_400
export const MILLISECONDS_PER_SECOND = 1_000
