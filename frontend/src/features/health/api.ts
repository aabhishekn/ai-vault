import { ApiError, getJson } from '../../lib/api'

type HealthResponse = { status: 'ok' }

export async function getHealth(signal: AbortSignal): Promise<HealthResponse> {
  const data = await getJson('/health', signal)

  if (
    typeof data !== 'object' ||
    data === null ||
    !('status' in data) ||
    data.status !== 'ok'
  ) {
    throw new ApiError(
      'The service responded, but its health check was unexpected.',
    )
  }

  return { status: 'ok' }
}
