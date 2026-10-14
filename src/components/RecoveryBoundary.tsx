import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  label: string;
  resetKey: string;
  children: ReactNode;
}

export class RecoveryBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.label} failed`, error, info.componentStack);
  }

  componentDidUpdate(previous: Props) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full min-h-32 flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <AlertTriangle className="h-6 w-6 text-amber-300" />
        <strong className="text-white">{this.props.label} could not be displayed</strong>
        <p className="max-w-md break-words text-xs text-zinc-400">{this.state.error.message}</p>
        <p className="max-w-md text-xs text-teal-200/80">Your completed workspace is stored outside this view. Use Backup before reloading the application.</p>
        <button onClick={() => this.setState({ error: null })} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/10">
          <RotateCcw className="h-3.5 w-3.5" /> Retry This View
        </button>
      </div>
    );
  }
}