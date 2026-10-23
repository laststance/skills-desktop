import { Component, type ReactNode } from 'react'

/** Contains Tree rendering failures while leaving the Inspector, cache and view switch mounted.
 * @example <SkillTreeBoundary useList={useList}><SkillsTree /></SkillTreeBoundary>
 */
export class SkillTreeBoundary extends Component<
  { children: ReactNode; useList: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(): void {
    // Only a stable module code is logged; filenames and raw component exceptions are excluded.
    console.warn('[TREE_RENDER] SkillsTree')
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div
        role="alert"
        className="flex h-full flex-col items-center justify-center gap-3 p-4 text-sm"
      >
        <p>Tree view could not be displayed.</p>
        <div className="flex gap-3">
          <button
            type="button"
            className="min-h-6 text-primary"
            onClick={() => this.setState({ failed: false })}
          >
            Try again
          </button>
          <button
            type="button"
            className="min-h-6 text-primary"
            onClick={this.props.useList}
          >
            Use List
          </button>
        </div>
      </div>
    )
  }
}
