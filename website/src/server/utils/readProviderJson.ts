import { UNSPLASH_MAX_RESPONSE_BYTES } from '../constants'

/** Bounds actual bytes while {@link requestProvider} reads a successful upstream response.
 * @param response - Provider response whose HTTP status was already checked.
 * @returns Parsed JSON; invalid/oversized data throws without keeping the response stream alive.
 * @example readProviderJson(Response.json({ total_pages: 0, results: [] })) // Resolves the JSON object.
 */
export async function readProviderJson(response: Response): Promise<unknown> {
  if (
    Number(response.headers.get('content-length')) >
      UNSPLASH_MAX_RESPONSE_BYTES ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined)
    throw new RangeError('Provider response limit exceeded or body missing')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const decode = (chunk?: Uint8Array<ArrayBuffer>, stream = false): string => {
    try {
      return decoder.decode(chunk, { stream })
    } catch {
      // Invalid bytes are malformed provider data; stream/network failures retain their separate classification.
      throw new SyntaxError('Provider response is not valid UTF-8')
    }
  }
  let bytes = 0
  let body = ''
  try {
    // Count chunks too: Content-Length can be absent or dishonest.
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > UNSPLASH_MAX_RESPONSE_BYTES)
        throw new RangeError('Provider response limit exceeded')
      body += decode(chunk.value, true)
    }
    return JSON.parse(body + decode())
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
