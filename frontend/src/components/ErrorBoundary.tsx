import { Component, type ReactNode } from 'react'

/** Contains a crash to the part of the screen that failed, instead of blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; onReset?: () => void; compact?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[albedo] ${this.props.label ?? 'panel'} crashed`, error)
  }

  reset = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={`err-boundary ${this.props.compact ? 'compact' : ''}`} role="alert">
        <b>{this.props.label ?? 'This panel'} hit a problem.</b>
        <span className="muted">The rest of Albedo-Watch is still running.</span>
        <button className="btn btn-ghost btn-sm" onClick={this.reset}>Try again</button>
      </div>
    )
  }
}
