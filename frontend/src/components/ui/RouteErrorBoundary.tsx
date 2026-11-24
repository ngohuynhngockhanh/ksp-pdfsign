import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PageShell } from "./PageShell";

export interface RouteErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  onReset?: () => void;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

function isChunkLoadFailure(error: Error | null): boolean {
  if (!error) return false;
  const text = `${error.name || ""} ${error.message || ""}`.toLowerCase();
  return (
    text.includes("chunkloaderror") ||
    text.includes("loading chunk") ||
    text.includes("dynamically imported module") ||
    text.includes("importing a module script failed") ||
    text.includes("failed to fetch")
  );
}

export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[RouteErrorBoundary]", error, info.componentStack);
  }

  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (
      this.state.hasError &&
      this.props.resetKey !== undefined &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, error: null });
    }
  }

  resetErrorBoundary = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const chunkFailure = isChunkLoadFailure(this.state.error);
    const detail = this.state.error?.message?.trim() || "";

    return (
      <PageShell>
        <div
          className="ui-error-boundary"
          role="alert"
          data-testid="route-error-boundary"
        >
          <div className="ui-error-boundary-card">
            <EmptyState
              icon="alert-triangle"
              title={
                chunkFailure
                  ? "Không thể tải mô-đun trang"
                  : "Đã xảy ra lỗi hiển thị trang"
              }
              description={
                <>
                  <span>
                    {chunkFailure
                      ? "Phiên bản ứng dụng vừa được cập nhật hoặc kết nối mạng bị gián đoạn khi tải trang này. Vui lòng thử lại hoặc tải lại ứng dụng."
                      : "Đã xảy ra lỗi ngoài dự kiến khi hiển thị trang này. Dữ liệu hệ thống vẫn an toàn."}
                  </span>
                  {detail && (
                    <span className="ui-error-boundary-msg">{detail}</span>
                  )}
                </>
              }
              action={
                <div className="ui-error-boundary-actions">
                  <AppButton
                    variant="primary"
                    leftIcon="refresh"
                    data-testid="error-boundary-retry"
                    onClick={this.resetErrorBoundary}
                  >
                    Thử lại
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    leftIcon="rotate-ccw"
                    data-testid="error-boundary-reload"
                    onClick={this.handleReload}
                  >
                    Tải lại ứng dụng
                  </AppButton>
                </div>
              }
            />
          </div>
        </div>
      </PageShell>
    );
  }
}
