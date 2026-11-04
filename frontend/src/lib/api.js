export class ApiError extends Error {
  status

  constructor(message, status) {
    super(message)
    this.status = status
  }
}

export async function requestJson(path, signal, options = undefined) {
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
  return response.json()
}

export function getJson(path, signal) {
  return requestJson(path, signal)
}
