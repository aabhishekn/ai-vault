export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

type PostOptions = { method: 'POST' } & (
  | { body?: FormData; json?: never }
  | { json: Record<string, unknown>; body?: never }
)

export async function requestJson(
  path: `/${string}`,
  signal: AbortSignal,
  options: PostOptions | undefined = undefined,
): Promise<unknown> {
  const { json, ...requestOptions } = options ?? {}
  const response = await fetch(`/api${path}`, {
    ...requestOptions,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
    signal,
    headers: {
      Accept: 'application/json',
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
  })
  if (!response.ok) {
    throw new ApiError(
      'The document service is unavailable. Make sure your backend is running, then try again.',
      response.status,
    )
  }
  return response.json() as Promise<unknown>
}

export function getJson(
  path: `/${string}`,
  signal: AbortSignal,
): Promise<unknown> {
  return requestJson(path, signal)
}
