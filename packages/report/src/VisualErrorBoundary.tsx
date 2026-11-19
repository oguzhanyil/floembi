import { Component, Fragment, type ReactNode } from "react";

/** Görselin render/effect hatası sayfanın diğer nesnelerini etkilemez. */
export class VisualErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { error: Error | null; attempt: number }
> {
  state = { error: null as Error | null, attempt: 0 };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (previous.resetKey !== this.props.resetKey && this.state.error) this.retry();
  }
  retry = () => this.setState(({ attempt }) => ({ error: null, attempt: attempt + 1 }));
  render() {
    if (this.state.error) return <div className="v-error" role="alert" onClick={(e) => e.stopPropagation()}>
      <strong>Bu görsel yüklenemedi</strong>
      <details><summary>Hata ayrıntısı</summary><p>{this.state.error.message}</p></details>
      <button type="button" onClick={this.retry}>Tekrar dene</button>
    </div>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}
