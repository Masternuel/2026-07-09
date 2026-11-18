import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
  componentStack: string;
  retryKey: number;
}

interface AppErrorFallbackProps {
  error: Error;
  componentStack: string;
  showTechnicalDetails: boolean;
  onRetry: () => void;
  onReload: () => void;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error ?? 'Erro desconhecido'));
}

export function AppErrorFallback({
  error,
  componentStack,
  showTechnicalDetails,
  onRetry,
  onReload,
}: AppErrorFallbackProps) {
  return (
    <main className="app-error-screen" role="alert" aria-labelledby="app-error-title">
      <section className="app-error-card">
        <span className="app-error-card__mark" aria-hidden="true">!</span>
        <p className="eyebrow">RECUPERAÇÃO DO JOGO</p>
        <h1 id="app-error-title">O jogo encontrou um problema</h1>
        <p>Seus saves continuam intactos. Tente abrir esta tela novamente ou recarregue o jogo.</p>

        <div className="app-error-card__actions">
          <button type="button" className="button button--primary" onClick={onRetry}>Tentar novamente</button>
          <button type="button" className="button button--secondary" onClick={onReload}>Recarregar jogo</button>
        </div>

        {showTechnicalDetails && (
          <details className="app-error-card__details">
            <summary>Detalhes técnicos</summary>
            <pre>{error.message}{componentStack ? `\n${componentStack.trim()}` : ''}</pre>
          </details>
        )}
      </section>
    </main>
  );
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    componentStack: '',
    retryKey: 0,
  };

  static getDerivedStateFromError(error: unknown): Partial<AppErrorBoundaryState> {
    return { error: normalizeError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Bola Manager] Erro de renderização capturado.', error, info);
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  handleRetry = () => {
    this.setState((current) => ({
      error: null,
      componentStack: '',
      retryKey: current.retryKey + 1,
    }));
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error, componentStack, retryKey } = this.state;
    if (error) {
      return (
        <AppErrorFallback
          error={error}
          componentStack={componentStack}
          showTechnicalDetails={import.meta.env.DEV}
          onRetry={this.handleRetry}
          onReload={this.handleReload}
        />
      );
    }

    return <Fragment key={retryKey}>{this.props.children}</Fragment>;
  }
}
