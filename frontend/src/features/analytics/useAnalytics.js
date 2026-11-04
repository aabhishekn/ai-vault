import { useResource } from '../../hooks/useResource'
import { getDocumentStatistics, getProcessingMetrics } from './analytics'

const STATS_ERROR =
  'We couldn’t load document statistics. Check your connection and try again.'
const METRICS_ERROR =
  'We couldn’t load processing metrics. Check your connection and try again.'

// Both reads are independent so one failing endpoint never hides the other.
export function useAnalytics() {
  const statistics = useResource(
    'statistics',
    getDocumentStatistics,
    STATS_ERROR,
  )
  const metrics = useResource('metrics', getProcessingMetrics, METRICS_ERROR)
  function refresh() {
    statistics.refresh()
    metrics.refresh()
  }
  return { statistics: statistics.state, metrics: metrics.state, refresh }
}
