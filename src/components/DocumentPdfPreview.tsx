import { useEffect, useId, useState } from 'react'
import { downloadDocumentPdf, getDocumentPdf, type DocumentPdfArtifact, type DocumentPdfSource } from '../services/documentPdf'
import './document-pdf.css'

export default function DocumentPdfPreview({ source, title = 'Document PDF', onReady, onLoading, refreshKey = '', compact = false }: {
  source: DocumentPdfSource; title?: string; onReady?: (artifact: DocumentPdfArtifact | null) => void
  onLoading?: (loading: boolean) => void; refreshKey?: string; compact?: boolean
}) {
  const [artifact, setArtifact] = useState<DocumentPdfArtifact | null>(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const key = JSON.stringify(source)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    const controller = new AbortController()
    setArtifact(null); setUrl(''); setError(''); onReady?.(null); onLoading?.(true)
    void getDocumentPdf(JSON.parse(key), controller.signal).then(pdf => {
      if (!active) return
      objectUrl = URL.createObjectURL(pdf.blob)
      setArtifact(pdf); setUrl(objectUrl); onReady?.(pdf)
    }).catch(failure => {
      if (active) setError(failure instanceof Error ? failure.message : 'The document PDF could not be opened.')
    }).finally(() => { if (active) onLoading?.(false) })
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // Callbacks report state; their identity must not republish a document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refreshKey, attempt])
  return <section className={'document-pdf-preview'+(compact?' document-pdf-compact':'')} aria-label={title}>
    <div className="document-pdf-toolbar"><strong>{title}</strong>{artifact && <div className="personal-delivery-actions">{compact?<button type="button" className="secondary-button" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?'Hide PDF':'View PDF'}</button>:<button type="button" className="text-button" onClick={() => setAttempt(value => value + 1)}>Reload PDF</button>}<button type="button" className={compact?'text-button':'secondary-button'} onClick={() => downloadDocumentPdf(artifact)}>Download PDF</button></div>}</div>
    {error ? <div role="alert"><p>{error}</p><button type="button" className="secondary-button" onClick={() => setAttempt(value => value + 1)}>Retry PDF</button></div>
      : !artifact ? <p role="status">Preparing your finished document…</p>
      : <div id={id} hidden={compact&&!expanded}>{(!compact||expanded)&&<><iframe className="document-pdf-frame" src={url} title={title} />
      <p className="quiet">This is the saved PDF used for customer viewing and delivery. <a href={url} target="_blank" rel="noopener noreferrer">Open PDF</a> or download it if your browser cannot display it here.</p>{compact&&<button type="button" className="text-button" onClick={()=>setAttempt(value=>value+1)}>Reload PDF</button>}</>}</div>}
  </section>
}
