import {StrictMode, Component, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

class ErrorBoundary extends Component<{children: ReactNode}, {error: Error | null}> {
  state = {error: null};
  static getDerivedStateFromError(e: Error) { return {error: e}; }
  render() {
    if (this.state.error) {
      return <div style={{padding:40,fontFamily:'monospace',fontSize:14,color:'#e00',whiteSpace:'pre-wrap'}}>{this.state.error.stack}</div>;
    }
    return this.props.children;
  }
}

// 全局未捕获错误
window.addEventListener('error', (e) => {
  document.title = 'ERROR: ' + (e.error?.message || e.message);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
