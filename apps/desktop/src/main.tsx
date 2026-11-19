import { Component, type ErrorInfo, type ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./dialogs.css";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Floem BI ekranı yüklenemedi", error, info.componentStack);
  }

  render() {
    if (this.state.error) return (
      <div className="boot boot-error" role="alert">
        <strong>Floem BI ekranı yüklenemedi</strong>
        <p>{this.state.error.message}</p>
        <button type="button" onClick={() => window.location.reload()}>Yeniden yükle</button>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary><App /></AppErrorBoundary>
  </StrictMode>,
);
