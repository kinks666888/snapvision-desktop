import React from 'react';

interface Props {
  children: React.ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? ':' + this.props.name : ''}]`, error, errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: '#ef4444', padding: '20px', fontSize: '12px' }}>
          <h3 style={{ fontWeight: 'bold', marginBottom: '8px' }}>
            ⚠️ 组件异常 {this.props.name ? `(${this.props.name})` : ''}
          </h3>
          <pre style={{ color: '#f87171', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message}
          </pre>
          <pre style={{ color: '#9ca3af', fontSize: '10px', marginTop: '8px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
