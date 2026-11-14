import {microphonePermissionSteps,type MicrophoneFailure} from '../lib/microphone'

export default function MicrophoneRecovery({failure,canDictate,onRetry,onDictate,onType}:{failure:MicrophoneFailure;canDictate:boolean;onRetry:()=>void;onDictate:()=>void;onType:()=>void}) {
  return <section className="fin-microphone-recovery" aria-label="Microphone help">
    <div role="alert"><strong>{failure.title}</strong><p>{failure.message}</p></div>
    {failure.kind==='permission'&&<ol>{microphonePermissionSteps().map(step=><li key={step}>{step}</li>)}</ol>}
    <div className="fin-recovery-actions">
      {failure.kind==='context'?<a className="primary-button" href="https://finviant.com/" target="_blank" rel="noopener noreferrer">Open Finviant directly</a>:<button type="button" className="secondary-button" onClick={onRetry}>Retry microphone</button>}
      {canDictate&&failure.stage!=='dictation'&&['recorder','unavailable'].includes(failure.kind)&&<button type="button" className="primary-button" onClick={onDictate}>Use browser dictation</button>}
      <button type="button" className="secondary-button" onClick={onType}>Type instead</button>
    </div>
    <details><summary>Microphone error details</summary><p>{failure.stage==='access'?'Microphone access':failure.stage==='recorder'?'Audio recording':'Browser dictation'} · {failure.code}</p>{failure.detail&&<p>{failure.detail}</p>}</details>
  </section>
}
