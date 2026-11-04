export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.status = status
  }
}

export async function requestJson(
  path: `/${string}`,
  signal: AbortSignal,
  options: { method: 'POST'; body?: FormData } | undefined = undefined,
): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    ...options,
    signal,
    headers: { Accept: 'application/json' },
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
