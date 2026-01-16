import { Component, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches rendering errors and displays a fallback UI.
 * Prevents the entire app from crashing due to errors in child components.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Error info:", errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="h-screen flex items-center justify-center bg-black p-4">
          <div className="max-w-md w-full border border-[#ff0000] p-6">
            <div className="text-center mb-6">
              <div className="text-[#ff0000] text-4xl mb-4 font-mono">[!]</div>
              <h1 className="text-xs uppercase tracking-widest text-[#ff0000] mb-2">
                SYSTEM_ERROR
              </h1>
              <p className="text-[10px] uppercase tracking-wider text-white/40">
                SOMETHING WENT WRONG
              </p>
            </div>
            
            {this.state.error && (
              <div className="mb-6 p-3 border border-white/20 bg-white/5">
                <p className="text-[10px] uppercase tracking-wider text-white/50 mb-1">
                  ERROR_MESSAGE:
                </p>
                <p className="text-xs text-[#ff0000] font-mono break-all">
                  {this.state.error.message || "Unknown error"}
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={this.handleRetry}
                className="flex-1"
              >
                [RETRY]
              </Button>
              <Button
                variant="danger"
                onClick={this.handleReload}
                className="flex-1"
              >
                [RELOAD]
              </Button>
            </div>

            <div className="mt-6 text-[10px] text-white/20 text-center font-mono">
              SYS.STATUS: ERROR | RECOVERY: AVAILABLE
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
