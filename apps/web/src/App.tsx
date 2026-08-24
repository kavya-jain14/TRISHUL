import { useEffect, useMemo, useState } from 'react';
import type { CaseDetail, GraphEdge, GraphSnapshot } from '@trishul/contracts';
import { ApiError, loadCaseIntelligence, runGoldenTraceDemo } from './lib/api';

type ApiState = 'checking' | 'ready' | 'unavailable';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';

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
  ['TRACE', 'Idempotent and versioned'],
  ['Demo data', 'Deterministic simulator'],
] as const;

function formatMoney(amountMinor?: number) {
  if (amountMinor === undefined) return 'No amount';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function CaseIntelligence({ apiBase }: { apiBase: string }) {
  const [caseId, setCaseId] = useState('case:complaint-golden-a');
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [graphPending, setGraphPending] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [demoProgress, setDemoProgress] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectedEdge = useMemo(
    () => graph?.edges.find((edge) => edge.edgeId === selectedEdgeId) ?? null,
    [graph, selectedEdgeId],
  );

  const load = async (targetCaseId = caseId) => {
    setLoadState('loading');
    setErrorMessage('');
    try {
      const result = await loadCaseIntelligence(targetCaseId, apiBase);
      setCaseDetail(result.caseDetail);
      setGraph(result.graph);
      setGraphPending(result.graphPending);
      setSelectedEdgeId(result.graph?.edges[0]?.edgeId ?? null);
      setLoadState('ready');
    } catch (error) {
      setCaseDetail(null);
      setGraph(null);
      setGraphPending(false);
      setLoadState('error');
      setErrorMessage(
        error instanceof ApiError ? `${error.code}: ${error.message}` : 'Case could not be loaded.',
      );
    }
  };

  const runDemo = async () => {
    setLoadState('loading');
    setErrorMessage('');
    try {
      const loadedCaseId = await runGoldenTraceDemo(setDemoProgress, apiBase);
      setCaseId(loadedCaseId);
      await load(loadedCaseId);
    } catch (error) {
      setLoadState('error');
      setErrorMessage(
        error instanceof ApiError
          ? `${error.code}: ${error.message}`
          : 'The deterministic trace demo could not complete.',
      );
    }
  };

  return (
    <section className="case-workspace">
      <div className="case-toolbar">
        <div>
          <span className="section-label">Complaint-led investigation</span>
          <h2>Case Intelligence</h2>
          <p>Every visible edge below is returned by TRACE with provider provenance.</p>
        </div>
        <div className="case-controls">
          <label htmlFor="case-id">Case ID</label>
          <div>
            <input
              id="case-id"
              onChange={(event) => setCaseId(event.target.value)}
              value={caseId}
            />
            <button disabled={loadState === 'loading'} onClick={() => void load()} type="button">
              Load case
            </button>
          </div>
          <button
            className="secondary-action"
            disabled={loadState === 'loading'}
            onClick={() => void runDemo()}
            type="button"
          >
            Run deterministic trace demo
          </button>
        </div>
      </div>

      {loadState === 'loading' && (
        <div className="intentional-state loading-state">
          <span className="status-dot" />
          <div>
            <strong>Building from backend evidence</strong>
            <p>{demoProgress || 'Loading case and graph state...'}</p>
          </div>
        </div>
      )}

      {loadState === 'error' && (
        <div className="intentional-state error-state">
          <strong>Case Intelligence unavailable</strong>
          <p>{errorMessage}</p>
        </div>
      )}

      {loadState === 'idle' && (
        <div className="intentional-state empty-state">
          <strong>No case loaded</strong>
          <p>Load an existing case or run the labelled synthetic provider scenario.</p>
        </div>
      )}

      {loadState === 'ready' && caseDetail && (
        <>
          <div className="case-facts">
            <article>
              <span>Case state</span>
              <strong>{caseDetail.summary.state.replaceAll('_', ' ')}</strong>
            </article>
            <article>
              <span>Transaction anchor</span>
              <strong>{caseDetail.summary.originalTransactionRef}</strong>
            </article>
            <article>
              <span>Resolved beneficiary</span>
              <strong>{caseDetail.resolvedBeneficiaryAccount ?? 'Awaiting resolution'}</strong>
            </article>
            <article>
              <span>Ledger / processed</span>
              <strong>
                {caseDetail.providerEventCount} / {caseDetail.processedEventCount}
              </strong>
            </article>
          </div>

          {graphPending && (
            <div className="intentional-state pending-state">
              <strong>TRACE has not produced a graph yet</strong>
              <p>
                The case is real, but the UI will not invent nodes or edges. Run TRACE after
                provider events arrive.
              </p>
            </div>
          )}

          {graph && (
            <>
              <div className="coverage-boundary">
                <span>Observed coverage boundary</span>
                <strong>{graph.coverageBoundary}</strong>
                <small>Graph version {graph.graphVersion}</small>
              </div>

              <div className="graph-layout">
                <article className="trace-panel">
                  <div className="card-heading">
                    <div>
                      <span className="section-label">Observed money trail</span>
                      <h3>{graph.edges.length} provenance-backed edges</h3>
                    </div>
                    <span className="version-badge">v{graph.graphVersion}</span>
                  </div>
                  <div className="edge-list">
                    {graph.edges.map((edge, index) => (
                      <button
                        className={
                          edge.edgeId === selectedEdgeId ? 'edge-row selected' : 'edge-row'
                        }
                        key={edge.edgeId}
                        onClick={() => setSelectedEdgeId(edge.edgeId)}
                        type="button"
                      >
                        <span className="edge-index">{String(index + 1).padStart(2, '0')}</span>
                        <span className="edge-route">
                          <strong>{edge.fromNodeId}</strong>
                          <small>{edge.type.replaceAll('_', ' ')}</small>
                          <strong>{edge.toNodeId}</strong>
                        </span>
                        <span className="edge-amount">{formatMoney(edge.amount?.amountMinor)}</span>
                      </button>
                    ))}
                  </div>
                  <div className="node-inventory">
                    <span>Observed nodes</span>
                    <div>
                      {graph.nodes.map((node) => (
                        <span key={node.nodeId}>{node.label}</span>
                      ))}
                    </div>
                  </div>
                </article>

                <ProvenancePanel edge={selectedEdge} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function ProvenancePanel({ edge }: { edge: GraphEdge | null }) {
  return (
    <article className="provenance-panel">
      <span className="section-label">Edge evidence</span>
      <h3>{edge ? edge.edgeId : 'Select an edge'}</h3>
      {edge ? (
        <dl>
          <div>
            <dt>Source</dt>
            <dd>{edge.provenance.sourceName}</dd>
          </div>
          <div>
            <dt>Source type</dt>
            <dd>{edge.provenance.sourceType}</dd>
          </div>
          <div>
            <dt>Provider event</dt>
            <dd>{edge.provenance.sourceEventId}</dd>
          </div>
          <div>
            <dt>Evidence state</dt>
            <dd>{edge.provenance.evidenceState}</dd>
          </div>
          <div>
            <dt>Occurred</dt>
            <dd>{new Date(edge.occurredAt).toLocaleString('en-IN')}</dd>
          </div>
          <div>
            <dt>Observed</dt>
            <dd>{new Date(edge.provenance.observedAt).toLocaleString('en-IN')}</dd>
          </div>
        </dl>
      ) : (
        <p>Choose an observed transfer to inspect its source and timestamp.</p>
      )}
    </article>
  );
}

function CommandCenter({ manifest }: { manifest: SystemManifest | null }) {
  return (
    <>
      <section className="intro-panel">
        <div>
          <span className="section-label">Current checkpoint</span>
          <h2>Complaint-to-trace intelligence is wired.</h2>
          <p>
            Provider events are accepted through strict contracts, replayed safely, ordered by
            financial time, and converted into a versioned graph only when provenance exists.
          </p>
        </div>
        <div className="phase-stamp">
          <span>BUILD STATE</span>
          <strong>{manifest?.phase.replaceAll('_', ' ') ?? 'PHASE 1 TRACE SLICE'}</strong>
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
              <span className="section-label">Live vertical slice</span>
              <h3>Complaint to TRACE</h3>
            </div>
            <span className="priority">P0</span>
          </div>
          <ol>
            <li>Complaint creates an idempotent reported case</li>
            <li>Provider resolution anchors the beneficiary account</li>
            <li>Financial events enter a conflict-safe chronological ledger</li>
            <li>TRACE returns a versioned graph and explicit visibility boundary</li>
          </ol>
        </article>

        <article className="work-card guardrails">
          <div className="card-heading">
            <div>
              <span className="section-label">Always enforced</span>
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
              <dt>Graph edge</dt>
              <dd>Provider provenance required</dd>
            </div>
            <div>
              <dt>Replay</dt>
              <dd>Idempotent or rejected</dd>
            </div>
          </dl>
        </article>
      </section>
    </>
  );
}

export function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  const [activeModule, setActiveModule] = useState(0);
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
              className={index === activeModule ? 'nav-item active' : 'nav-item'}
              key={item}
              onClick={() => setActiveModule(index)}
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
            <h1>{navigation[activeModule]}</h1>
          </div>
          <div className={`service-state ${apiState}`}>
            <span className="status-dot" />
            {apiState === 'checking' && 'Checking services'}
            {apiState === 'ready' && 'API online'}
            {apiState === 'unavailable' && 'API not running'}
          </div>
        </header>

        {activeModule === 0 && <CommandCenter manifest={manifest} />}
        {activeModule === 2 && <CaseIntelligence apiBase={apiBase} />}
        {activeModule !== 0 && activeModule !== 2 && (
          <section className="intentional-state module-pending">
            <strong>{navigation[activeModule]} is intentionally not mocked.</strong>
            <p>This module will unlock when its backend contracts land in the assigned phase.</p>
          </section>
        )}
      </main>
    </div>
  );
}
