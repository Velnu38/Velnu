import { createContext, useContext } from 'react'
export const WorkspaceNavigation = createContext<(() => void) | null>(null)
export default function WorkspaceBack() {
  const back = useContext(WorkspaceNavigation)
  return back ? <div className="detail-top"><button type="button" className="back-button" onClick={back}>← Back</button></div> : null
}
