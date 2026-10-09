import { afterEach, expect, test, vi } from 'vitest'
import { ApiError, request } from './api'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response
    return response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

test('sends a JSON body with a content-type and returns the parsed response', async () => {
  const fetchMock = stubFetch(json(201, { id: 1, name: 'Tech', items: [] }))
  await expect(request('POST', '/watchlists', { name: 'Tech' })).resolves.toEqual({ id: 1, name: 'Tech', items: [] })
  expect(fetchMock).toHaveBeenCalledWith('/api/watchlists', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"name":"Tech"}',
  })
})

test.each(['POST', 'DELETE'])('sends no content-type on a bodyless %s', async (method) => {
  const fetchMock = stubFetch(new Response(null, { status: 204 }))
  await expect(request(method, '/symbols/3/retry')).resolves.toBeUndefined()
  expect(fetchMock).toHaveBeenCalledWith('/api/symbols/3/retry', { method })
})

test('throws the server error message with its status', async () => {
  stubFetch(json(400, { error: 'Name is required' }))
  const error = await request('POST', '/watchlists', { name: '' }).catch((e) => e)
  expect(error).toBeInstanceOf(ApiError)
  expect(error).toMatchObject({ status: 400, message: 'Name is required' })
})

test('falls back to a generic message when the error body is not JSON', async () => {
  stubFetch(new Response('<html>Bad gateway</html>', { status: 502 }))
  await expect(request('GET', '/watchlists')).rejects.toMatchObject({ status: 502, message: 'Request failed (502)' })
})

test('reports an unreachable server', async () => {
  stubFetch(new TypeError('Failed to fetch'))
  await expect(request('GET', '/watchlists')).rejects.toMatchObject({ status: 0, message: 'Cannot reach the server' })
})
