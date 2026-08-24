import { useEffect, useState } from 'react';

type ApiState = 'checking' | 'ready' | 'unavailable';

interface SystemManifest {
  product: string;
  phase: string;
  capabilities: string[];
}

const navigation = [
  'Command Center',
  'Payment Risk / Verify',
  'Case Intelligence',
  'Geo / Prediction',
  'Secure Resolution',
  'Audit / Outcome',
] as const;

const foundationItems = [
  ['Contracts', 'Runtime validated'],
  ['Evidence', 'Provenance required'],
  ['Forecast', 'Predict or abstain'],
  ['Demo data', 'Deterministic simulator'],
] as const;

export function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  const apiBase = import.meta.env.VITE_API_BASE_URL ?? '/api/v1';

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${apiBase}/system/manifest`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API unavailable');
        return (await response.json()) as SystemManifest;
      })
      .then((data) => {
        setManifest(data);
        setApiState('ready');
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setApiState('unavailable');
      });

    return () => controller.abort();
  }, [apiBase]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            T
          </div>
          <div>
            <strong>TRISHUL</strong>
            <span>Intelligence workspace</span>
          </div>
        </div>

        <nav aria-label="Primary navigation">
          {navigation.map((item, index) => (
            <button
              className={index === 0 ? 'nav-item active' : 'nav-item'}
              key={item}
              type="button"
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {item}
            </button>
          ))}
        </nav>

        <div className="doctrine-note">
          <span>Operational doctrine</span>
          <p>Evidence first. Prediction only when support is sufficient.</p>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span className="eyebrow">SIH 2026 / PS26184</span>
            <h1>Command Center</h1>
          </div>
          <div className={`service-state ${apiState}`}>
            <span className="status-dot" />
            {apiState === 'checking' && 'Checking services'}
            {apiState === 'ready' && 'Foundation online'}
            {apiState === 'unavailable' && 'API not running'}
          </div>
        </header>

        <section className="intro-panel">
          <div>
            <span className="section-label">Current checkpoint</span>
            <h2>Evidence spine established.</h2>
            <p>
              The repository is ready for the first complaint-to-trace vertical slice. No live case
              is loaded, so no graph, risk verdict, or forecast is being fabricated here.
            </p>
          </div>
          <div className="phase-stamp">
            <span>BUILD STATE</span>
            <strong>{manifest?.phase.replaceAll('_', ' ') ?? 'PHASE 0 FOUNDATION'}</strong>
          </div>
        </section>

        <section className="foundation-grid" aria-label="Foundation capabilities">
          {foundationItems.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>

        <section className="workspace-grid">
          <article className="work-card next-slice">
            <div className="card-heading">
              <div>
                <span className="section-label">Next vertical slice</span>
                <h3>Complaint to trace</h3>
              </div>
              <span className="priority">P0</span>
            </div>
            <ol>
              <li>Receive complaint and original transaction reference</li>
              <li>Resolve the beneficiary through the provider adapter</li>
              <li>Consume idempotent financial events with provenance</li>
              <li>Return a versioned graph with an explicit coverage boundary</li>
            </ol>
          </article>

          <article className="work-card guardrails">
            <div className="card-heading">
              <div>
                <span className="section-label">Always visible</span>
                <h3>Decision guardrails</h3>
              </div>
            </div>
            <dl>
              <div>
                <dt>Intent</dt>
                <dd>Never inferred</dd>
              </div>
              <div>
                <dt>Complaint</dt>
                <dd>Case anchor, not blacklist</dd>
              </div>
              <div>
                <dt>Weak evidence</dt>
                <dd>Abstain and monitor</dd>
              </div>
              <div>
                <dt>Confirmed mule</dt>
                <dd>Authorised outcome only</dd>
              </div>
            </dl>
          </article>
        </section>
      </main>
    </div>
  );
}
