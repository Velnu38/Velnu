import type {ReactNode} from 'react'
import './document-review.css'
export default function DocumentActions({primary,secondary}:{primary:ReactNode;secondary?:ReactNode}) {
 return <section className="document-action-card" aria-label="Document actions"><h2>Actions</h2><div className="document-action-grid" role="group" aria-label="Common actions">{primary}</div>{secondary&&<div className="document-more-actions"><h3>More actions</h3><div className="document-action-grid" role="group" aria-label="More actions">{secondary}</div></div>}</section>
}
