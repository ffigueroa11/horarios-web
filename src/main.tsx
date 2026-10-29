import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import App from './App';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { missingFeatures, requestPersistence } from './store/health';
import { registerServiceWorker } from './store/sw';

const root = createRoot(document.getElementById('root')!);
const missing = missingFeatures();

if (missing.length > 0) {
  root.render(
    <div className="welcome">
      <section className="card" role="alert">
        <h1>Este navegador no puede usar Horarios Web</h1>
        <p>Le falta: {missing.join(', ')}. Usa una versión reciente de Chrome, Edge, Firefox o Safari, en una ventana normal (no de incógnito).</p>
      </section>
    </div>,
  );
} else {
  void requestPersistence();
  registerServiceWorker();
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
}
