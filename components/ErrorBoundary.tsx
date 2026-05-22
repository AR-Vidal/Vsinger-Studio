import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-white p-6 text-zinc-900">
        <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl">
          <h1 className="text-lg font-semibold">页面渲染出错</h1>
          <p className="mt-2 text-sm text-zinc-600">
            已捕获一次界面错误，点击下方按钮可恢复页面。
          </p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs text-zinc-600">
            {this.state.error.message}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
          >
            恢复页面
          </button>
        </div>
      </div>
    );
  }
}
