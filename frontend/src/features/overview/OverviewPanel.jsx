import { Button } from '../../components/Button'
import {
  formatCount,
  formatDuration,
  formatFileSize,
  formatPercent,
} from '../../lib/format'
import { DOCUMENT_STATUSES } from '../documents/types'
import { STATUS_LABELS } from '../documents/status'

import { useOverview } from './useOverview'

function Stat({ label, value }) {
  return (
    <div className="rounded-[10px] border border-evidence-border bg-surface px-4 py-3">
      <dt className="text-[11px] font-semibold text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Group({ title, state, children }) {
  return (
    <section aria-label={title} aria-busy={state.status === 'loading'}>
      <h3 className="mb-3 text-[13px] font-semibold">{title}</h3>
      {state.status === 'loading' && (
        <p className="text-[13px] text-muted" role="status">
          Loading…
        </p>
      )}
      {state.status === 'error' && (
        <p className="text-[13px] text-error" role="alert">
          {state.message}
        </p>
      )}
      {state.status === 'success' && children(state.data)}
    </section>
  )
}

function DocumentStats({ data }) {
  return (
    <>
      <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
        <Stat label="Documents" value={formatCount(data.totalDocuments)} />
        <Stat label="Storage" value={formatFileSize(data.totalStorageBytes)} />
        <Stat label="Pages" value={formatCount(data.totalExtractedPages)} />
        <Stat
          label="With summary"
          value={formatCount(data.documentsWithSummary)}
        />
        <Stat
          label="Searchable chunks"
          value={`${formatCount(data.chunksWithEmbeddings)} / ${formatCount(data.totalChunks)}`}
        />
      </dl>
      <ul className="mt-3 flex list-none flex-wrap gap-2 text-xs text-muted">
        {DOCUMENT_STATUSES.map((status) => (
          <li
            key={status}
            className="rounded-full border border-panel-border px-3 py-1"
          >
            {STATUS_LABELS[status]}: {formatCount(data.byStatus[status])}
          </li>
        ))}
      </ul>
    </>
  )
}

function ProcessingStats({ data }) {
  if (data.totalAttempts === 0)
    return (
      <p className="text-[13px] leading-[1.8] text-muted">
        No processing attempts recorded yet. Upload a PDF to see timing and
        success rates.
      </p>
    )
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-3">
      <Stat label="Attempts" value={formatCount(data.totalAttempts)} />
      <Stat label="Success rate" value={formatPercent(data.successRate)} />
      <Stat label="Failed" value={formatCount(data.failed)} />
      <Stat label="In progress" value={formatCount(data.processing)} />
      <Stat
        label="Average time"
        value={formatDuration(data.averageDurationMs)}
      />
      <Stat label="Slowest" value={formatDuration(data.maxDurationMs)} />
      <Stat
        label="Embedding tokens"
        value={formatCount(data.observedEmbeddingInputTokens)}
      />
    </dl>
  )
}

export function OverviewPanel() {
  const { statistics, metrics, refresh } = useOverview()
  const busy = statistics.status === 'loading' || metrics.status === 'loading'
  return (
    <details className="mt-10 rounded-2xl border border-panel-border bg-surface shadow-panel">
      <summary className="cursor-pointer px-6 py-4 text-sm font-semibold select-none">
        Workspace metrics
      </summary>
      <section
        className="border-t border-rule p-6"
        aria-labelledby="overview-heading"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 id="overview-heading" className="text-base font-semibold">
            Workspace overview
          </h2>
          <Button
            onClick={() => {
              if (!busy) refresh()
            }}
            aria-disabled={busy}
          >
            Refresh overview
          </Button>
        </div>
        <div className="grid gap-6">
          <Group title="Documents" state={statistics}>
            {(data) => <DocumentStats data={data} />}
          </Group>
          <Group title="Processing" state={metrics}>
            {(data) => <ProcessingStats data={data} />}
          </Group>
        </div>
        <p className="mt-5 text-xs leading-[1.8] text-muted">
          Reading these numbers never calls the AI provider. Processing metrics
          count attempts since metrics were introduced.
        </p>
      </section>
    </details>
  )
}
