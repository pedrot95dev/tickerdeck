import type { Fetch } from '../src/providers.js'

type Call = { url: string; headers: Record<string, string> }

/** A `fetch` that records every call and answers with whatever `respond` returns. */
export function fakeFetch(respond: (url: URL) => { status?: number; headers?: Record<string, string>; body: unknown }) {
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> })
    const { status = 200, headers, body } = respond(new URL(String(input)))
    return new Response(JSON.stringify(body), { status, headers })
  }) as Fetch
  return { fetch, calls }
}
