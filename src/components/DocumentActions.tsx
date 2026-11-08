import type {ReactNode} from 'react'
import {RecordMoreMenu} from './RecordDetail'
import './document-review.css'
export default function DocumentActions({primary,secondary}:{primary:ReactNode;secondary?:ReactNode}) {
 return <section className="document-action-card" aria-label="Document actions"><h2>Actions</h2>{primary&&<div className="document-action-grid" role="group" aria-label="Common actions">{primary}</div>}{secondary&&<RecordMoreMenu className="document-more-actions" label="More actions" contentClassName="document-action-grid">{secondary}</RecordMoreMenu>}</section>
}
