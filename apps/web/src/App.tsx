import { useEffect, useMemo, useState } from 'react';
import type {
  AccountExposureState,
  CaseDetail,
  GraphEdge,
  GraphSnapshot,
  MuleAssessmentSnapshot,
} from '@trishul/contracts';
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
  const [exposureStates, setExposureStates] = useState<AccountExposureState[]>([]);
  const [exposurePending, setExposurePending] = useState(false);
  const [riskAssessments, setRiskAssessments] = useState<MuleAssessmentSnapshot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [demoProgress, setDemoProgress] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  const selectedEdge = useMemo(
    () => graph?.edges.find((edge) => edge.edgeId === selectedEdgeId) ?? null,
    [graph, selectedEdgeId],
  );
  const selectedExposure = useMemo(
    () => exposureStates.find((state) => state.accountId === selectedAccountId) ?? null,
    [exposureStates, selectedAccountId],
  );
  const selectedRisk = useMemo(
    () =>
      riskAssessments.find(
        (assessment) =>
          assessment.accountId === selectedAccountId &&
          assessment.graphVersion === caseDetail?.summary.graphVersion,
      ) ?? null,
    [caseDetail?.summary.graphVersion, riskAssessments, selectedAccountId],
  );

  const load = async (targetCaseId = caseId) => {
    setLoadState('loading');
    setErrorMessage('');
    try {
      const result = await loadCaseIntelligence(targetCaseId, apiBase);
      setCaseDetail(result.caseDetail);
      setGraph(result.graph);
      setGraphPending(result.graphPending);
      setExposureStates(result.exposure?.states ?? []);
      setExposurePending(result.exposurePending);
      setRiskAssessments(result.riskAssessments);
      setSelectedEdgeId(result.graph?.edges[0]?.edgeId ?? null);
      setSelectedAccountId(
        result.exposure?.states[0]?.accountId ??
          result.graph?.nodes.find((node) => node.type === 'ACCOUNT')?.nodeId ??
          null,
      );
      setLoadState('ready');
    } catch (error) {
      setCaseDetail(null);
      setGraph(null);
      setGraphPending(false);
      setExposureStates([]);
      setExposurePending(false);
      setRiskAssessments([]);
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
              <span>Ledger / risk snapshots</span>
              <strong>
                {caseDetail.providerEventCount} / {caseDetail.riskAssessmentCount}
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
                    <span>Observed nodes - select an account for intelligence</span>
                    <div>
                      {graph.nodes.map((node) => (
                        <button
                          className={node.nodeId === selectedAccountId ? 'selected' : ''}
                          disabled={node.type !== 'ACCOUNT'}
                          key={node.nodeId}
                          onClick={() => setSelectedAccountId(node.nodeId)}
                          type="button"
                        >
                          {node.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </article>

                <ProvenancePanel edge={selectedEdge} />
              </div>

              {exposurePending && (
                <div className="intentional-state pending-state">
                  <strong>Exposure has not been calculated for graph v{graph.graphVersion}</strong>
                  <p>
                    Known-clean balance evidence is required. The UI will not turn observed outgoing
                    value into an exact fraud amount.
                  </p>
                </div>
              )}

              {exposureStates.length > 0 && (
                <div className="intelligence-layout">
                  <ExposurePanel
                    onSelect={setSelectedAccountId}
                    selectedAccountId={selectedAccountId}
                    states={exposureStates}
                  />
                  <RiskPanel
                    assessment={selectedRisk}
                    exposure={selectedExposure}
                    selectedAccountId={selectedAccountId}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

function ExposurePanel({
  states,
  selectedAccountId,
  onSelect,
}: {
  states: AccountExposureState[];
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
}) {
  return (
    <article className="exposure-panel">
      <div className="card-heading">
        <div>
          <span className="section-label">Commingled-funds accounting</span>
          <h3>Attributable exposure ranges</h3>
        </div>
        <span className="version-badge">{states[0]?.methodVersion}</span>
      </div>
      <p className="panel-note">
        Observed movement is factual. The range states what may be attributable after known-clean
        funds are considered.
      </p>
      <div className="exposure-list">
        {states.map((state) => (
          <button
            aria-pressed={state.accountId === selectedAccountId}
            className={state.accountId === selectedAccountId ? 'selected' : ''}
            key={state.exposureStateId}
            onClick={() => onSelect(state.accountId)}
            type="button"
          >
            <span>
              <strong>{state.accountId}</strong>
              <small>graph v{state.graphVersion}</small>
            </span>
            <span>
              <small>Observed outgoing</small>
              <strong>{formatMoney(state.observedOutgoingMinor)}</strong>
            </span>
            <span>
              <small>Attributable range</small>
              <strong>
                {formatMoney(state.minimumAttributableMinor)} to{' '}
                {formatMoney(state.maximumAttributableMinor)}
              </strong>
            </span>
          </button>
        ))}
      </div>
    </article>
  );
}

function RiskPanel({
  assessment,
  exposure,
  selectedAccountId,
}: {
  assessment: MuleAssessmentSnapshot | null;
  exposure: AccountExposureState | null;
  selectedAccountId: string | null;
}) {
  return (
    <article className="risk-panel">
      <span className="section-label">Explainable mule / network risk</span>
      <h3>{selectedAccountId ?? 'Select an account'}</h3>
      {exposure && (
        <div className="selected-range">
          <span>Defensible attributable range</span>
          <strong>
            {formatMoney(exposure.minimumAttributableMinor)} to{' '}
            {formatMoney(exposure.maximumAttributableMinor)}
          </strong>
        </div>
      )}
      {assessment ? (
        <>
          <div className={`risk-state ${assessment.state.toLowerCase()}`}>
            <span>{assessment.state.replaceAll('_', ' ')}</span>
            <strong>{assessment.score}/100</strong>
          </div>
          <p className="confirmation-boundary">
            {assessment.state === 'CONFIRMED' && assessment.trustedOutcome.status === 'CONFIRMED'
              ? `Confirmed only by trusted outcome ${assessment.trustedOutcome.institutionalReference}.`
              : 'This is an explainable recommendation, not a confirmed mule finding.'}
          </p>
          <dl className="risk-features">
            <div>
              <dt>Pass-through</dt>
              <dd>{Math.round(assessment.features.behaviour.passThrough * 100)}%</dd>
            </div>
            <div>
              <dt>Network proximity</dt>
              <dd>{Math.round(assessment.features.network.reportedNetworkProximity * 100)}%</dd>
            </div>
            <div>
              <dt>Rapid forwarding</dt>
              <dd>{Math.round(assessment.features.movement.rapidForwarding * 100)}%</dd>
            </div>
            <div>
              <dt>Signal source</dt>
              <dd>{assessment.signalProvenance.sourceName}</dd>
            </div>
          </dl>
          <div className="reason-codes">
            {assessment.reasonCodes.map((reason) => (
              <span key={reason}>{reason.replaceAll('_', ' ')}</span>
            ))}
          </div>
        </>
      ) : (
        <div className="risk-empty">
          <strong>No current risk assessment for this account</strong>
          <p>One complaint or one rapid transfer is never promoted to a mule verdict.</p>
        </div>
      )}
    </article>
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
          <h2>Trace, exposure, and account risk are wired.</h2>
          <p>
            Provider events are accepted through strict contracts, replayed safely, ordered by
            financial time, converted into a versioned graph, and evaluated as ranges and
            explainable multi-signal risk only when evidence exists.
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
              <h3>Complaint to account intelligence</h3>
            </div>
            <span className="priority">P0</span>
          </div>
          <ol>
            <li>Complaint creates an idempotent reported case</li>
            <li>Provider resolution anchors the beneficiary account</li>
            <li>Financial events enter a conflict-safe chronological ledger</li>
            <li>TRACE returns a versioned graph and explicit visibility boundary</li>
            <li>Exposure and risk stay versioned, explainable, and provenance-backed</li>
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
            <div>
              <dt>Mule state</dt>
              <dd>Confirmed only by trusted outcome</dd>
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
