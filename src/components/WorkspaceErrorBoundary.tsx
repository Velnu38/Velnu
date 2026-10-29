import { Component, type ReactNode } from 'react'

/** Keep a failed module download or rendering error from blanking the workspace. */
export default class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <section className="empty-state" role="alert">
        <h2>This page could not be opened</h2>
        <p>Check your connection and reload, or choose another workspace page. Review saved records before repeating your last action; unsaved edits may need to be entered again.</p>
        <button className="secondary-button" onClick={() => window.location.reload()}>Reload workspace</button>
      </section>
    }
    return this.props.children
  }
}
