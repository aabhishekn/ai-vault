import type { DocumentAnswer } from './answers'

export function AnswerResult({ result }: { result: DocumentAnswer }) {
  return (
    <div className="mt-5 wrap-anywhere">
      <p className="mb-2 text-[11px] font-semibold text-muted">Your question</p>
      <p className="mb-5 text-[13px] leading-[1.8] whitespace-pre-wrap">
        {result.question}
      </p>
      <h4 className="mb-2 text-sm font-semibold">
        {result.insufficient_evidence ? 'Not enough evidence' : 'Answer'}
      </h4>
      <p className="text-[13px] leading-[1.9] whitespace-pre-wrap">
        {result.answer}
      </p>
      {result.citations.length > 0 && (
        <div className="mt-5">
          <h4 className="mb-3 text-xs font-semibold">Sources</h4>
          <ol className="grid list-none gap-3">
            {result.citations.map((citation) => (
              <li key={citation.source_number}>
                <details className="rounded-[10px] border border-evidence-border bg-[#f7f8f1] p-4">
                  <summary className="cursor-pointer text-xs font-semibold text-success">
                    [{citation.source_number}]
                    {citation.filename ? ` · ${citation.filename}` : ''} · Page{' '}
                    {citation.page_number}
                  </summary>
                  <blockquote className="mt-3 border-l-2 border-[#bdcbb0] pl-3 text-xs leading-[1.8] whitespace-pre-wrap text-muted">
                    {citation.text}
                  </blockquote>
                </details>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
