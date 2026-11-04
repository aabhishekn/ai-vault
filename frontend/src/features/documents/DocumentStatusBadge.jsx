import { STATUS_LABELS } from './status'

const statusStyles = {
  embedded: 'bg-success-soft text-success',
  ready: 'bg-success-soft text-success',
  extracted: 'bg-[#edf4f0] text-[#426b64]',
  uploading: 'bg-[#ecf2f8] text-[#496a86]',
  queued: 'bg-[#f8f1e3] text-[#89662b]',
  processing: 'bg-[#ecf2f8] text-[#496a86]',
  failed: 'bg-danger-soft text-danger',
}

export function DocumentStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-[20px] px-[9px] py-[5px] text-[10px] leading-[1.4] font-semibold whitespace-nowrap ${statusStyles[status]}`}
    >
      <span className="size-[5px] rounded-full bg-current" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  )
}
