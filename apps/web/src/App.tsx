import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AccountExposureState,
  CaseDetail,
  EvidenceDimensionDecision,
  EvidenceGateSnapshot,
  ExitModeSnapshot,
  ForecastSnapshot,
  GraphEdge,
  GraphSnapshot,
  MuleAssessmentSnapshot,
  PaymentRiskAssessment,
} from '@trishul/contracts';
import {
  ApiError,
  evaluateDemoPaymentRisk,
  loadCaseIntelligence,
  loadPredictionReadiness,
  runGoldenTraceDemo,
  runStationaryGateDemo,
} from './lib/api';

type ApiState = 'checking' | 'ready' | 'unavailable';
type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type WorkspaceKey = 'command' | 'verify' | 'trace' | 'evidence' | 'intervene' | 'audit';

interface SystemManifest {
  product: string;
  phase: string;
  persistenceMode?: string;
  trustAccessMode?: string;
  capabilities: string[];
}

const workflow = [
  { key: 'verify', index: '01', label: 'Intake & verify' },
  { key: 'trace', index: '02', label: 'Bounded trace' },
  { key: 'evidence', index: '03', label: 'Evidence gate' },
  { key: 'intervene', index: '04', label: 'Intervention' },
  { key: 'audit', index: '05', label: 'Audit & outcome' },
] as const;

function formatMoney(amountMinor?: number) {
  if (amountMinor === undefined) return 'Not available';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}

function humanize(value: string) {
  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}

function statusFor(key: WorkspaceKey, active: WorkspaceKey) {
  if (key === active) return 'ACTIVE';
  if (key === 'verify') return 'COMPLETE';
  if (key === 'trace')
    return ['evidence', 'intervene', 'audit'].includes(active) ? 'COMPLETE' : 'READY';
  if (key === 'evidence') return ['intervene', 'audit'].includes(active) ? 'COMPLETE' : 'READY';
  if (key === 'audit') return 'RECORDING';
  return 'WAITING';
}

function OperatorHeader({ apiState, onHome }: { apiState: ApiState; onHome: () => void }) {
  return (
    <header className="operator-header">
      <button
        aria-label="Open Command Center"
        className="brand-lockup"
        onClick={onHome}
        type="button"
      >
        <span aria-hidden="true" className="brand-mark">
          Ψ
        </span>
        <span>
          <strong>TRISHUL</strong>
          <small>FINANCIAL INTELLIGENCE LAYER</small>
        </span>
      </button>
      <div aria-live="polite" className="network-state">
        <span className={`network-dot ${apiState}`} />
        <strong>
          {apiState === 'ready'
            ? 'SIMULATED PROVIDER NETWORK'
            : apiState === 'checking'
              ? 'CHECKING PROVIDER NETWORK'
              : 'PROVIDER NETWORK OFFLINE'}
        </strong>
        <i>•</i>
        <span>POLICY v1.8</span>
      </div>
      <div className="operator-identity">
        <span aria-hidden="true">KJ</span>
        <div>
          <strong>Kavya Jain</strong>
          <small>INVESTIGATOR · DEMO</small>
        </div>
      </div>
    </header>
  );
}

function WorkflowRail({
  active,
  onNavigate,
}: {
  active: WorkspaceKey;
  onNavigate: (key: WorkspaceKey) => void;
}) {
  return (
    <aside className="workflow-rail">
      <div className="active-case">
        <span>ACTIVE CASE</span>
        <strong>TR-2026-0142</strong>
        <small>Priority 92</small>
      </div>
      <nav aria-label="Case workflow">
        {workflow.map((item) => {
          const current = item.key === active;
          return (
            <button
              aria-current={current ? 'step' : undefined}
              className={current ? 'workflow-step active' : 'workflow-step'}
              key={item.key}
              onClick={() => onNavigate(item.key)}
              type="button"
            >
              <span>{item.index}</span>
              <span>
                <strong>{item.label}</strong>
                <small>{statusFor(item.key, active)}</small>
              </span>
              <i aria-hidden="true" />
            </button>
          );
        })}
      </nav>
      <div className="authority-boundary">
        <span>AUTHORITY BOUNDARY</span>
        <p>Provider evidence only. No autonomous freezing or identity disclosure.</p>
      </div>
    </aside>
  );
}

function LoadingState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="intentional-state loading-state">
      <span className="pulse-dot" />
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="intentional-state error-state">
      <span>REQUEST STOPPED</span>
      <strong>Evidence workspace unavailable</strong>
      <p>{message}</p>
      {onRetry && (
        <button onClick={onRetry} type="button">
          Retry verified scenario
        </button>
      )}
    </div>
  );
}

interface PositionedNode {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
}

function graphPositions(graph: GraphSnapshot): PositionedNode[] {
  const incoming = new Map<string, number>();
  const level = new Map<string, number>();
  graph.nodes.forEach((node) => incoming.set(node.nodeId, 0));
  graph.edges.forEach((edge) => {
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
  });
  const roots = graph.nodes.filter((node) => (incoming.get(node.nodeId) ?? 0) === 0);
  roots.forEach((node) => level.set(node.nodeId, 0));
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    graph.edges.forEach((edge) => {
      const fromLevel = level.get(edge.fromNodeId);
      if (fromLevel !== undefined) {
        level.set(edge.toNodeId, Math.max(level.get(edge.toNodeId) ?? 0, fromLevel + 1));
      }
    });
  }
  graph.nodes.forEach((node) => {
    if (!level.has(node.nodeId)) level.set(node.nodeId, 0);
  });
  const maxLevel = Math.max(1, ...level.values());
  const byLevel = new Map<number, typeof graph.nodes>();
  graph.nodes.forEach((node) => {
    const nodeLevel = level.get(node.nodeId) ?? 0;
    byLevel.set(nodeLevel, [...(byLevel.get(nodeLevel) ?? []), node]);
  });
  return graph.nodes.map((node) => {
    const nodeLevel = level.get(node.nodeId) ?? 0;
    const group = byLevel.get(nodeLevel) ?? [node];
    const index = group.findIndex((candidate) => candidate.nodeId === node.nodeId);
    return {
      id: node.nodeId,
      label: node.label,
      type: node.type,
      x: 10 + (nodeLevel / maxLevel) * 72,
      y: group.length === 1 ? 48 : 22 + (index / (group.length - 1)) * 54,
    };
  });
}

function MoneyFlowGraph({
  graph,
  exposureStates,
  selectedNodeId,
  selectedEdgeId,
  onSelectNode,
  onSelectEdge,
}: {
  graph: GraphSnapshot;
  exposureStates: AccountExposureState[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  onSelectNode: (id: string) => void;
  onSelectEdge: (id: string) => void;
}) {
  const positions = useMemo(() => graphPositions(graph), [graph]);
  const positionById = useMemo(
    () => new Map(positions.map((node) => [node.id, node])),
    [positions],
  );
  const exposureById = useMemo(
    () => new Map(exposureStates.map((state) => [state.accountId, state])),
    [exposureStates],
  );

  return (
    <div aria-label="Provider-confirmed money-flow graph" className="money-flow-canvas">
      <svg
        aria-hidden="true"
        className="graph-links"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        {graph.edges.map((edge) => {
          const from = positionById.get(edge.fromNodeId);
          const to = positionById.get(edge.toNodeId);
          if (!from || !to) return null;
          const isSelected = edge.edgeId === selectedEdgeId;
          return (
            <g key={edge.edgeId} onClick={() => onSelectEdge(edge.edgeId)}>
              <line className="graph-link-hitbox" x1={from.x} x2={to.x} y1={from.y} y2={to.y} />
              <line
                className={isSelected ? 'graph-link selected' : 'graph-link'}
                x1={from.x}
                x2={to.x}
                y1={from.y}
                y2={to.y}
              />
            </g>
          );
        })}
        <line className="graph-link boundary" x1="82" x2="94" y1="72" y2="72" />
      </svg>

      {positions.map((node, index) => {
        const exposure = exposureById.get(node.id);
        const selected = node.id === selectedNodeId;
        return (
          <button
            className={selected ? 'graph-node selected' : 'graph-node'}
            key={node.id}
            onClick={() => onSelectNode(node.id)}
            style={{ left: `${node.x}%`, top: `${node.y}%` }}
            type="button"
          >
            <small>{index === 0 ? 'ORIGIN' : node.type}</small>
            <strong>{node.label}</strong>
            <span>
              {exposure
                ? `${formatMoney(exposure.minimumAttributableMinor)}–${formatMoney(exposure.maximumAttributableMinor)}`
                : node.type === 'ACCOUNT'
                  ? 'Provider observed'
                  : humanize(node.type)}
            </span>
          </button>
        );
      })}

      <div className="visibility-node">
        <small>VISIBILITY BOUNDARY</small>
        <strong>No authorised events</strong>
      </div>
    </div>
  );
}

function EvidenceInspector({
  nodeId,
  edge,
  exposure,
  risk,
}: {
  nodeId: string | null;
  edge: GraphEdge | null;
  exposure: AccountExposureState | null;
  risk: MuleAssessmentSnapshot | null;
}) {
  const reasons = risk?.reasonCodes.slice(0, 3) ?? [];
  return (
    <aside className="evidence-inspector">
      <span className="section-label">SELECTED EVIDENCE NODE</span>
      <h3>{nodeId ?? 'Select a node'}</h3>
      <p>Attributable exposure</p>
      <div className="inspector-facts">
        <div>
          <span>EXPOSURE</span>
          <strong>
            {exposure
              ? `${formatMoney(exposure.minimumAttributableMinor)}–${formatMoney(exposure.maximumAttributableMinor)}`
              : 'Pending'}
          </strong>
        </div>
        <div>
          <span>RISK STATE</span>
          <strong>{risk ? humanize(risk.state) : 'Not assessed'}</strong>
        </div>
        <div className="wide">
          <span>EVIDENCE STATE</span>
          <strong>{edge ? humanize(edge.provenance.evidenceState) : 'Select an edge'}</strong>
        </div>
      </div>
      <div className="risk-reasons">
        <span>WHY OPERATIONAL RISK IS ELEVATED</span>
        {reasons.length ? (
          reasons.map((reason, index) => (
            <div key={reason}>
              <b>{String(index + 1).padStart(2, '0')}</b>
              <p>
                <strong>{humanize(reason)}</strong>
                <small>
                  {index === 0
                    ? 'Observed behaviour differs from the account baseline.'
                    : index === 1
                      ? 'Network evidence connects this node to the active investigation.'
                      : 'Fund movement increases the active intervention priority.'}
                </small>
              </p>
            </div>
          ))
        ) : (
          <p className="no-risk-reasons">
            No risk reason is promoted without a current, version-matched assessment.
          </p>
        )}
      </div>
      {edge && (
        <div className="edge-provenance">
          <span>SELECTED EDGE PROVENANCE</span>
          <strong>{edge.provenance.sourceName}</strong>
          <small>{edge.provenance.sourceEventId}</small>
          <small>{new Date(edge.provenance.observedAt).toLocaleString('en-IN')}</small>
        </div>
      )}
    </aside>
  );
}

function TraceWorkspace({ apiBase }: { apiBase: string }) {
  const [caseId, setCaseId] = useState('case:complaint-golden-a');
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [graph, setGraph] = useState<GraphSnapshot | null>(null);
  const [graphPending, setGraphPending] = useState(false);
  const [exposureStates, setExposureStates] = useState<AccountExposureState[]>([]);
  const [riskAssessments, setRiskAssessments] = useState<MuleAssessmentSnapshot[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [demoProgress, setDemoProgress] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  const apply = (result: Awaited<ReturnType<typeof loadCaseIntelligence>>) => {
    setCaseDetail(result.caseDetail);
    setGraph(result.graph);
    setGraphPending(result.graphPending);
    setExposureStates(result.exposure?.states ?? []);
    setRiskAssessments(result.riskAssessments);
    setSelectedEdgeId(result.graph?.edges.at(-1)?.edgeId ?? null);
    setSelectedAccountId(
      result.exposure?.states.at(-1)?.accountId ?? result.graph?.nodes.at(-1)?.nodeId ?? null,
    );
    setLoadState('ready');
  };

  const load = async (targetCaseId = caseId) => {
    setLoadState('loading');
    setErrorMessage('');
    try {
      apply(await loadCaseIntelligence(targetCaseId, apiBase));
    } catch (error) {
      setLoadState('error');
      setErrorMessage(
        error instanceof ApiError
          ? `${error.code}: ${error.message}`
          : 'The case could not be loaded.',
      );
    }
  };

  const runDemo = async () => {
    setLoadState('loading');
    setErrorMessage('');
    try {
      const loadedCaseId = await runGoldenTraceDemo(setDemoProgress, apiBase);
      setCaseId(loadedCaseId);
      apply(await loadCaseIntelligence(loadedCaseId, apiBase));
    } catch (error) {
      setLoadState('error');
      setErrorMessage(
        error instanceof ApiError
          ? `${error.code}: ${error.message}`
          : 'The verified trace scenario could not complete.',
      );
    }
  };

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void runDemo();
  }, []);

  const selectedEdge = graph?.edges.find((edge) => edge.edgeId === selectedEdgeId) ?? null;
  const selectedExposure =
    exposureStates.find((state) => state.accountId === selectedAccountId) ?? null;
  const selectedRisk =
    riskAssessments.find(
      (assessment) =>
        assessment.accountId === selectedAccountId &&
        assessment.graphVersion === caseDetail?.summary.graphVersion,
    ) ?? null;
  const outgoingAccounts = new Set(graph?.edges.map((edge) => edge.fromNodeId) ?? []);
  const terminalExposure = exposureStates.filter((state) => !outgoingAccounts.has(state.accountId));
  const totalMinimum = terminalExposure.reduce(
    (sum, state) => sum + state.minimumAttributableMinor,
    0,
  );
  const totalMaximum = terminalExposure.reduce(
    (sum, state) => sum + state.maximumAttributableMinor,
    0,
  );

  return (
    <section className="trace-workspace workspace-screen">
      <div className="workspace-title-row">
        <div>
          <span className="case-kicker">CASE / CMP-2841</span>
          <h1>Where did the reported funds move?</h1>
        </div>
        <div className="case-summary-strip">
          <div>
            <span>REPORTED</span>
            <strong>
              {formatMoney(caseDetail?.complaint.reportedAmount.amountMinor ?? 5_000_000)}
            </strong>
          </div>
          <div>
            <span>RECEIVED</span>
            <strong>
              {caseDetail
                ? new Date(caseDetail.complaint.reportedAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '10:30 IST'}
            </strong>
          </div>
          <div>
            <span>STATE</span>
            <strong className="active-copy">
              {caseDetail ? humanize(caseDetail.summary.state) : 'Active'}
            </strong>
          </div>
        </div>
      </div>

      <div className="case-query-bar">
        <label htmlFor="trace-case-id">CASE REFERENCE</label>
        <input
          id="trace-case-id"
          onChange={(event) => setCaseId(event.target.value)}
          value={caseId}
        />
        <button disabled={loadState === 'loading'} onClick={() => void load()} type="button">
          LOAD CASE
        </button>
        <button
          className="ghost-action"
          disabled={loadState === 'loading'}
          onClick={() => void runDemo()}
          type="button"
        >
          RESET VERIFIED DEMO
        </button>
      </div>

      {loadState === 'loading' && (
        <LoadingState
          detail={demoProgress || 'Resolving transaction and expanding the bounded graph…'}
          title="Building from provider evidence"
        />
      )}
      {loadState === 'error' && (
        <ErrorState message={errorMessage} onRetry={() => void runDemo()} />
      )}
      {loadState === 'ready' && graphPending && (
        <ErrorState message="TRACE has no graph for this case yet. The interface will not invent nodes or edges." />
      )}

      {loadState === 'ready' && graph && (
        <section className="trace-frame">
          <div className="trace-legend">
            <span>
              <i className="solid-line" /> SOLID EDGE = PROVIDER EVENT
            </span>
            <span>
              <i className="range-line" /> RANGE = COMMINGLING UNCERTAINTY
            </span>
            <span>
              <i className="dashed-line" /> DASHED = VISIBILITY BOUNDARY
            </span>
            <strong>Neo4j view · contract validated</strong>
          </div>
          <div className="trace-main">
            <article className="graph-panel">
              <div className="graph-heading">
                <div>
                  <span className="mint section-label">BOUNDED MONEY-FLOW GRAPH</span>
                  <h2>{graph.edges.length} verified downstream events</h2>
                </div>
                <div>
                  <span>CURRENT ATTRIBUTABLE EXPOSURE</span>
                  <strong>
                    {formatMoney(totalMinimum)}–{formatMoney(totalMaximum)}
                  </strong>
                </div>
              </div>
              <MoneyFlowGraph
                exposureStates={exposureStates}
                graph={graph}
                onSelectEdge={setSelectedEdgeId}
                onSelectNode={setSelectedAccountId}
                selectedEdgeId={selectedEdgeId}
                selectedNodeId={selectedAccountId}
              />
              <div className="coverage-footer">
                <span>OBSERVED COVERAGE</span>
                <strong>
                  {graph.coverageBoundary ?? 'All authorised provider events exhausted'}
                </strong>
                <small>
                  Graph v{graph.graphVersion} ·{' '}
                  {new Date(graph.generatedAt).toLocaleString('en-IN')}
                </small>
              </div>
            </article>
            <EvidenceInspector
              edge={selectedEdge}
              exposure={selectedExposure}
              nodeId={selectedAccountId}
              risk={selectedRisk}
            />
          </div>
        </section>
      )}
    </section>
  );
}

function GateCard({
  dimension,
  decision,
}: {
  dimension: 'Geo' | 'Time';
  decision: EvidenceDimensionDecision;
}) {
  return (
    <article className={`gate-card ${decision.decision.toLowerCase()}`}>
      <div>
        <span>{dimension.toUpperCase()} EVIDENCE</span>
        <strong>{decision.decision}</strong>
        <small>{humanize(decision.coverageState)}</small>
      </div>
      <div className="coverage-meter">
        <span style={{ width: `${decision.coverageScore * 100}%` }} />
      </div>
      <dl>
        <div>
          <dt>Coverage</dt>
          <dd>{Math.round(decision.coverageScore * 100)}%</dd>
        </div>
        <div>
          <dt>Stability</dt>
          <dd>{Math.round(decision.predictionStability * 100)}%</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{decision.provenance.sourceName}</dd>
        </div>
      </dl>
      <p>{decision.reasonCodes.map(humanize).join(' · ')}</p>
      {decision.missingEvidence.length > 0 && (
        <small>Missing: {decision.missingEvidence.map(humanize).join(' · ')}</small>
      )}
    </article>
  );
}

function ForecastPanel({ forecast }: { forecast: ForecastSnapshot }) {
  return (
    <section className="forecast-panel">
      <header>
        <div>
          <span className="mint section-label">BOUNDED OPERATIONAL FORECAST</span>
          <h2>Prediction is released only where evidence passed.</h2>
        </div>
        <div>
          <span>CONFIDENCE</span>
          <strong>{Math.round(forecast.confidence * 100)}%</strong>
          <small>Graph v{forecast.graphVersion}</small>
        </div>
      </header>
      <div className="forecast-columns">
        <article>
          <span>PROBABLE CASH-OUT ZONES</span>
          {forecast.geo.decision === 'PREDICT' ? (
            forecast.geo.candidates.map((candidate, index) => (
              <div className="forecast-rank" key={candidate.zoneId}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <p>
                  <strong>{candidate.label}</strong>
                  <small>{candidate.reasonCodes.map(humanize).join(' · ')}</small>
                  <i>
                    <span style={{ width: `${candidate.probability * 100}%` }} />
                  </i>
                </p>
                <em>{Math.round(candidate.probability * 100)}%</em>
              </div>
            ))
          ) : (
            <div className="abstain-block">
              <strong>Geo withheld</strong>
              <p>{forecast.geo.reasonCodes.map(humanize).join(' · ')}</p>
            </div>
          )}
        </article>
        <article>
          <span>BOUNDED TIME HORIZONS</span>
          {forecast.time.decision === 'PREDICT' ? (
            forecast.time.horizons.map((horizon, index) => (
              <div className="forecast-rank" key={horizon.bucket}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                <p>
                  <strong>{humanize(horizon.bucket)}</strong>
                  <small>{horizon.reasonCodes.map(humanize).join(' · ')}</small>
                  <i>
                    <span style={{ width: `${horizon.probability * 100}%` }} />
                  </i>
                </p>
                <em>{Math.round(horizon.probability * 100)}%</em>
              </div>
            ))
          ) : (
            <div className="abstain-block">
              <strong>Time withheld</strong>
              <p>{forecast.time.reasonCodes.map(humanize).join(' · ')}</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function EvidenceWorkspace({ apiBase }: { apiBase: string }) {
  const [caseId, setCaseId] = useState('case:complaint-golden-a');
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [exitMode, setExitMode] = useState<ExitModeSnapshot | null>(null);
  const [gate, setGate] = useState<EvidenceGateSnapshot | null>(null);
  const [forecast, setForecast] = useState<ForecastSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('idle');
  const [message, setMessage] = useState('');
  const bootstrapped = useRef(false);

  const run = async (scenario: 'supported' | 'stationary') => {
    setState('loading');
    setMessage('');
    try {
      const runner = scenario === 'supported' ? runGoldenTraceDemo : runStationaryGateDemo;
      const loadedCaseId = await runner(setMessage, apiBase);
      setCaseId(loadedCaseId);
      const result = await loadPredictionReadiness(loadedCaseId, apiBase);
      setCaseDetail(result.caseDetail);
      setExitMode(result.exitMode);
      setGate(result.evidenceGate);
      setForecast(result.forecast);
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(
        error instanceof ApiError
          ? `${error.code}: ${error.message}`
          : 'Evidence evaluation failed.',
      );
    }
  };

  useEffect(() => {
    if (!bootstrapped.current) {
      bootstrapped.current = true;
      void run('supported');
    }
  }, []);

  return (
    <section className="evidence-workspace workspace-screen">
      <div className="workspace-title-row">
        <div>
          <span className="case-kicker">EVIDENCE GATE / {caseId}</span>
          <h1>Is the evidence strong enough to forecast?</h1>
        </div>
        <div className="scenario-switch">
          <button onClick={() => void run('supported')} type="button">
            SUPPORTED PATH
          </button>
          <button onClick={() => void run('stationary')} type="button">
            ABSTAIN PATH
          </button>
        </div>
      </div>
      {state === 'loading' && (
        <LoadingState
          detail={message || 'Ranking exit mode before geo and time…'}
          title="Evaluating versioned evidence"
        />
      )}
      {state === 'error' && <ErrorState message={message} onRetry={() => void run('supported')} />}
      {state === 'ready' && caseDetail && (
        <>
          <section className="decision-strip">
            <div>
              <span>CASE STATE</span>
              <strong>{humanize(caseDetail.summary.state)}</strong>
            </div>
            <div>
              <span>EXIT MODE</span>
              <strong>{exitMode ? humanize(exitMode.selectedMode) : 'Not assessed'}</strong>
            </div>
            <div>
              <span>GATE DECISION</span>
              <strong>{gate?.overallDecision ?? 'Not assessed'}</strong>
            </div>
            <div>
              <span>FORECAST</span>
              <strong>{forecast ? 'VERSION CURRENT' : 'WITHHELD'}</strong>
            </div>
          </section>
          {gate && (
            <div className="gate-grid">
              <GateCard decision={gate.geo} dimension="Geo" />
              <GateCard decision={gate.time} dimension="Time" />
            </div>
          )}
          {gate?.overallDecision === 'ABSTAIN' && (
            <div className="abstention-banner">
              <span>ABSTAIN IS AN OPERATIONAL DECISION</span>
              <strong>Insufficient evidence; continue monitoring.</strong>
              <p>No map, exact ATM, or forced time estimate will be shown.</p>
            </div>
          )}
          {forecast && <ForecastPanel forecast={forecast} />}
        </>
      )}
    </section>
  );
}

function VerifyWorkspace({ apiBase }: { apiBase: string }) {
  const [amount, setAmount] = useState(5000);
  const [receiver, setReceiver] = useState('acct:receiver-a');
  const [state, setState] = useState<LoadState>('idle');
  const [assessment, setAssessment] = useState<PaymentRiskAssessment | null>(null);
  const [message, setMessage] = useState('');

  const evaluate = async () => {
    setState('loading');
    setMessage('Evaluating bank/PSP signals…');
    try {
      setAssessment(
        await evaluateDemoPaymentRisk(
          { amountRupees: amount, receiverReference: receiver },
          apiBase,
        ),
      );
      setState('ready');
    } catch (error) {
      setState('error');
      setMessage(
        error instanceof ApiError ? `${error.code}: ${error.message}` : 'Risk evaluation failed.',
      );
    }
  };

  return (
    <section className="verify-workspace workspace-screen">
      <div className="workspace-title-row">
        <div>
          <span className="case-kicker">PREVENT / PRE-PAYMENT DECISION</span>
          <h1>What should happen before this payment proceeds?</h1>
        </div>
      </div>
      <div className="verify-layout">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void evaluate();
          }}
        >
          <span className="mint section-label">PROVIDER-SUPPLIED PAYMENT CONTEXT</span>
          <label>
            Receiver reference
            <input value={receiver} onChange={(event) => setReceiver(event.target.value)} />
          </label>
          <label>
            Payment amount (₹)
            <input
              min="1"
              onChange={(event) => setAmount(Number(event.target.value))}
              type="number"
              value={amount}
            />
          </label>
          <button disabled={state === 'loading'} type="submit">
            EVALUATE PAYMENT
          </button>
          <p>
            TRISHUL evaluates observable transaction, receiver-behaviour and network signals. It
            does not infer payer or receiver intent.
          </p>
        </form>
        <article className="risk-decision-panel">
          {state === 'idle' && (
            <div className="decision-empty">
              <span>NO DECISION YET</span>
              <strong>Submit provider context to evaluate.</strong>
            </div>
          )}
          {state === 'loading' && (
            <LoadingState detail={message} title="Calculating explainable risk" />
          )}
          {state === 'error' && <ErrorState message={message} />}
          {state === 'ready' && assessment && (
            <>
              <span>PAYMENT DECISION</span>
              <h2>{assessment.decision}</h2>
              <p>
                {humanize(assessment.transactionAnomaly.band)} transaction anomaly ·{' '}
                {humanize(assessment.receiverBehaviour.band)} receiver behaviour ·{' '}
                {humanize(assessment.networkRisk.band)} network risk
              </p>
              <div className="risk-dimensions">
                <div>
                  <span>TRANSACTION</span>
                  <strong>{assessment.transactionAnomaly.score}/100</strong>
                </div>
                <div>
                  <span>RECEIVER</span>
                  <strong>{assessment.receiverBehaviour.score}/100</strong>
                </div>
                <div>
                  <span>NETWORK</span>
                  <strong>{assessment.networkRisk.score}/100</strong>
                </div>
              </div>
              <div className="reason-tags">
                {assessment.reasonCodes.map((reason) => (
                  <span key={reason}>{humanize(reason)}</span>
                ))}
              </div>
            </>
          )}
        </article>
      </div>
    </section>
  );
}

function CommandCenter({
  manifest,
  onOpenTrace,
}: {
  manifest: SystemManifest | null;
  onOpenTrace: () => void;
}) {
  const capabilities = [
    ['01', 'PREVENT', 'Explainable allow, warn or step-up before payment'],
    ['02', 'TRACE', 'Provider-confirmed money movement with a hard visibility boundary'],
    ['03', 'PREDICT / ABSTAIN', 'Independent geo and time Evidence Gates'],
    ['04', 'INTERVENE', 'Human-authorised action with reasons and audit lineage'],
  ];
  return (
    <section className="command-workspace workspace-screen">
      <div className="command-heading">
        <span>TRISHUL / OPERATIONAL OVERVIEW</span>
        <h1>One case. One evidence chain. No invented certainty.</h1>
        <p>
          The workspace carries a complaint from pre-payment risk through bounded tracing,
          evidence-gated prediction, authorised intervention and outcome capture.
        </p>
        <button onClick={onOpenTrace} type="button">
          OPEN ACTIVE CASE <b>→</b>
        </button>
      </div>
      <div className="command-status">
        <div>
          <span>SYSTEM PHASE</span>
          <strong>{manifest ? humanize(manifest.phase) : 'Loading manifest'}</strong>
        </div>
        <div>
          <span>PERSISTENCE</span>
          <strong>
            {manifest?.persistenceMode ? humanize(manifest.persistenceMode) : 'Development adapter'}
          </strong>
        </div>
        <div>
          <span>CAPABILITIES</span>
          <strong>{manifest?.capabilities.length ?? 0} validated</strong>
        </div>
      </div>
      <div className="capability-list">
        {capabilities.map(([index, title, detail]) => (
          <article key={title}>
            <span>{index}</span>
            <strong>{title}</strong>
            <p>{detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function BoundaryWorkspace({
  mode,
  manifest,
}: {
  mode: 'intervene' | 'audit';
  manifest: SystemManifest | null;
}) {
  const intervention = mode === 'intervene';
  return (
    <section className="boundary-workspace workspace-screen">
      <div className="workspace-title-row">
        <div>
          <span className="case-kicker">
            {intervention ? 'AUTHORISED INTERVENTION' : 'AUDIT / OUTCOME'}
          </span>
          <h1>
            {intervention
              ? 'What action is justified by the current evidence?'
              : 'Can every decision be reconstructed?'}
          </h1>
        </div>
      </div>
      <div className="boundary-grid">
        <article>
          <span>CONTROL STATE</span>
          <strong>{intervention ? 'HUMAN AUTHORISATION REQUIRED' : 'APPEND-ONLY RECORDING'}</strong>
          <p>
            {intervention
              ? 'TRISHUL recommends and packages evidence. A bank, PSP or authorised LEA operator remains responsible for the action.'
              : 'Case actions, reasons, evidence anchors, model versions and institutional outcomes remain linked for later review.'}
          </p>
        </article>
        <article>
          <span>AVAILABLE CONTRACTS</span>
          <dl>
            <div>
              <dt>Trust access</dt>
              <dd>
                {manifest?.trustAccessMode
                  ? humanize(manifest.trustAccessMode)
                  : 'Capability scoped'}
              </dd>
            </div>
            <div>
              <dt>Evidence integrity</dt>
              <dd>SHA-256 receipt + replaceable anchor provider</dd>
            </div>
            <div>
              <dt>Identity resolution</dt>
              <dd>Two-person approval, reference-only response</dd>
            </div>
            <div>
              <dt>Autonomous freeze</dt>
              <dd>Not permitted</dd>
            </div>
          </dl>
        </article>
      </div>
      <div className="operational-boundary">
        <span>WHY THIS SCREEN DOES NOT FAKE AN ACTION</span>
        <p>
          Recording a bank alert, LEA alert, identity-resolution decision or outcome requires a
          valid scoped credential and evidence anchor. The public synthetic profile intentionally
          exposes the boundary instead of bypassing it.
        </p>
      </div>
    </section>
  );
}

export function App() {
  const [apiState, setApiState] = useState<ApiState>('checking');
  const [manifest, setManifest] = useState<SystemManifest | null>(null);
  const [active, setActive] = useState<WorkspaceKey>('trace');
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
      <OperatorHeader apiState={apiState} onHome={() => setActive('command')} />
      {active !== 'command' && <WorkflowRail active={active} onNavigate={setActive} />}
      <main className={active === 'command' ? 'command-main' : ''}>
        {active === 'command' && (
          <CommandCenter manifest={manifest} onOpenTrace={() => setActive('trace')} />
        )}
        {active === 'verify' && <VerifyWorkspace apiBase={apiBase} />}
        {active === 'trace' && <TraceWorkspace apiBase={apiBase} />}
        {active === 'evidence' && <EvidenceWorkspace apiBase={apiBase} />}
        {active === 'intervene' && <BoundaryWorkspace manifest={manifest} mode="intervene" />}
        {active === 'audit' && <BoundaryWorkspace manifest={manifest} mode="audit" />}
      </main>
    </div>
  );
}
