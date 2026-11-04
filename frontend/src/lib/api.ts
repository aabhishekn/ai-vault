export class ApiError extends Error {}

export async function getJson(
  path: `/${string}`,
  signal: AbortSignal,
): Promise<unknown> {
  const response = await fetch(`/api${path}`, {
    signal,
    headers: { Accept: 'application/json' },
  })

  if (!response.ok) {
    throw new ApiError(
      'The document service is unavailable. Make sure your backend is running, then try again.',
    )
  }

  return response.json() as Promise<unknown>
}
