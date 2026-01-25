<script lang="ts">
  import { onMount, onDestroy } from "svelte";

  interface Props {
    runId: string;
  }

  let { runId }: Props = $props();

  interface AgentLogEntry {
    timestamp: string;
    agent: string;
    level: string;
    action: string;
    detail: string;
    data?: unknown;
    duration_ms?: number;
  }

  interface AgentLogCollection {
    agent: string;
    logs: AgentLogEntry[];
    start_time: string;
    end_time?: string;
    status: string;
    summary?: string;
  }

  interface OrchestratorSummary {
    total_duration_ms: number;
    stages_completed: string[];
    stages_skipped: string[];
    final_status: string;
    key_findings: string[];
    warnings: string[];
    errors: string[];
    hitl_reasons?: string[];
    next_steps?: string[];
  }

  interface RunLogReport {
    run_id: string;
    start_time: string;
    end_time?: string;
    status: string;
    agents: AgentLogCollection[];
    orchestrator_summary?: OrchestratorSummary;
  }

  let logReport: RunLogReport | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let selectedAgent: string | null = $state(null);
  let autoRefresh = $state(true);
  let refreshInterval: NodeJS.Timeout | null = null;

  const agentDisplayNames: Record<string, string> = {
    Orchestrator: "🎯 오케스트레이터",
    B_Gatekeeper: "🚪 B: 게이트키퍼",
    C_Extractor: "📄 C: 추출기",
    D_Normalizer: "🔄 D: 정규화기",
    E_Validator: "✅ E: 검증기",
    INS_Analyst: "📊 INSIGHTS: 분석가",
  };

  const levelIcons: Record<string, string> = {
    INFO: "ℹ️",
    SUCCESS: "✅",
    WARNING: "⚠️",
    ERROR: "❌",
    DEBUG: "🔧",
  };

  const statusColors: Record<string, string> = {
    RUNNING: "bg-blue-100 text-blue-800",
    SUCCESS: "bg-green-100 text-green-800",
    FAILED: "bg-red-100 text-red-800",
    PENDING: "bg-gray-100 text-gray-800",
    COMPLETED: "bg-green-100 text-green-800",
    HITL_REQUIRED: "bg-yellow-100 text-yellow-800",
  };

  async function fetchLogs() {
    try {
      const response = await fetch(`/api/runs/${runId}/logs`);
      if (!response.ok) {
        if (response.status === 404) {
          // 로그가 아직 없으면 빈 상태로
          logReport = null;
          return;
        }
        throw new Error("로그를 불러올 수 없습니다");
      }
      const result = await response.json();
      logReport = result.data;
      error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : "알 수 없는 오류";
    } finally {
      loading = false;
    }
  }

  function formatTime(isoString: string): string {
    const date = new Date(isoString);
    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}초`;
    return `${(ms / 60000).toFixed(1)}분`;
  }

  function toggleAgent(agent: string) {
    selectedAgent = selectedAgent === agent ? null : agent;
  }

  export function addLogEntry(entry: AgentLogEntry) {
    if (!logReport) return;

    // Find or create agent collection (though typically it should exist via fetchLogs or initial load)
    let collection = logReport.agents.find((a) => a.agent === entry.agent);

    if (!collection) {
      // If agent collection missing, we might need to re-fetch to get start_time etc.
      // For now, just try to fetch logs to sync up
      fetchLogs();
      return;
    }

    // Append log
    collection.logs = [...collection.logs, entry];

    // Auto-scroll or expand
    // If this is the first log for this agent, maybe expand it?
    if (collection.logs.length === 1 && !selectedAgent) {
      selectedAgent = entry.agent;
    }
  }

  onMount(() => {
    fetchLogs();
  });

  // No explicit onDestroy needed for interval anymore
</script>

<div class="agent-log-viewer">
  <div class="header">
    <h3>🤖 에이전트 실행 로그</h3>
    <div class="controls">
      <label class="auto-refresh">
        <input type="checkbox" bind:checked={autoRefresh} />
        자동 새로고침
      </label>
      <button onclick={fetchLogs} disabled={loading}>
        {loading ? "로딩중..." : "새로고침"}
      </button>
    </div>
  </div>

  {#if error}
    <div class="error-message">
      ❌ {error}
    </div>
  {:else if !logReport}
    <div class="empty-state">
      <p>📋 로그가 아직 생성되지 않았습니다.</p>
      <p class="hint">
        실행이 시작되면 여기에 각 에이전트의 활동이 표시됩니다.
      </p>
    </div>
  {:else}
    <!-- 상태 요약 -->
    <div class="status-summary">
      <div
        class="status-badge {statusColors[logReport.status] || 'bg-gray-100'}"
      >
        {logReport.status}
      </div>
      <span class="time-info">
        시작: {formatTime(logReport.start_time)}
        {#if logReport.end_time}
          → 종료: {formatTime(logReport.end_time)}
        {/if}
      </span>
    </div>

    <!-- 에이전트별 로그 -->
    <div class="agent-list">
      {#each logReport.agents as agentLog}
        <div
          class="agent-card {agentLog.status === 'RUNNING' ? 'running' : ''}"
        >
          <button
            class="agent-header"
            onclick={() => toggleAgent(agentLog.agent)}
          >
            <div class="agent-name">
              {agentDisplayNames[agentLog.agent] || agentLog.agent}
            </div>
            <div class="agent-status {statusColors[agentLog.status] || ''}">
              {agentLog.status}
            </div>
            <div class="expand-icon">
              {selectedAgent === agentLog.agent ? "▼" : "▶"}
            </div>
          </button>

          {#if agentLog.summary}
            <div class="agent-summary">
              {agentLog.summary}
            </div>
          {/if}

          {#if selectedAgent === agentLog.agent}
            <div class="log-entries">
              {#each agentLog.logs as log}
                <div class="log-entry {log.level.toLowerCase()}">
                  <div class="log-time">{formatTime(log.timestamp)}</div>
                  <div class="log-icon">{levelIcons[log.level] || "•"}</div>
                  <div class="log-content">
                    <div class="log-action">{log.action}</div>
                    <div class="log-detail">{log.detail}</div>
                    {#if log.duration_ms}
                      <div class="log-duration">
                        ⏱️ {formatDuration(log.duration_ms)}
                      </div>
                    {/if}
                    {#if log.data}
                      <details class="log-data">
                        <summary>데이터 보기</summary>
                        <pre>{JSON.stringify(log.data, null, 2)}</pre>
                      </details>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- 오케스트레이터 종합 리포트 -->
    {#if logReport.orchestrator_summary}
      <div class="orchestrator-summary">
        <h4>📊 종합 분석 결과</h4>

        <div class="summary-section">
          <div class="summary-item">
            <span class="label">⏱️ 총 소요 시간:</span>
            <span class="value"
              >{formatDuration(
                logReport.orchestrator_summary.total_duration_ms,
              )}</span
            >
          </div>
          <div class="summary-item">
            <span class="label">✅ 완료 단계:</span>
            <span class="value"
              >{logReport.orchestrator_summary.stages_completed.join(" → ") ||
                "없음"}</span
            >
          </div>
          {#if logReport.orchestrator_summary.stages_skipped.length > 0}
            <div class="summary-item">
              <span class="label">⏭️ 스킵 단계:</span>
              <span class="value"
                >{logReport.orchestrator_summary.stages_skipped.join(
                  ", ",
                )}</span
              >
            </div>
          {/if}
        </div>

        {#if logReport.orchestrator_summary.key_findings.length > 0}
          <div class="findings-section">
            <h5>🔍 주요 발견사항</h5>
            <ul>
              {#each logReport.orchestrator_summary.key_findings as finding}
                <li>{finding}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if logReport.orchestrator_summary.warnings.length > 0}
          <div class="warnings-section">
            <h5>⚠️ 경고</h5>
            <ul>
              {#each logReport.orchestrator_summary.warnings as warning}
                <li>{warning}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if logReport.orchestrator_summary.errors.length > 0}
          <div class="errors-section">
            <h5>❌ 오류</h5>
            <ul>
              {#each logReport.orchestrator_summary.errors as err}
                <li>{err}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if logReport.orchestrator_summary.hitl_reasons && logReport.orchestrator_summary.hitl_reasons.length > 0}
          <div class="hitl-section">
            <h5>👤 사람 검토 필요 사유</h5>
            <ul>
              {#each logReport.orchestrator_summary.hitl_reasons as reason}
                <li>{reason}</li>
              {/each}
            </ul>
          </div>
        {/if}

        {#if logReport.orchestrator_summary.next_steps && logReport.orchestrator_summary.next_steps.length > 0}
          <div class="next-steps-section">
            <h5>➡️ 다음 단계</h5>
            <ul>
              {#each logReport.orchestrator_summary.next_steps as step}
                <li>{step}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .agent-log-viewer {
    background: #1e1e2e;
    border-radius: 12px;
    padding: 20px;
    font-family: "SF Mono", "Fira Code", monospace;
    color: #cdd6f4;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
    padding-bottom: 12px;
    border-bottom: 1px solid #45475a;
  }

  .header h3 {
    margin: 0;
    font-size: 1.2em;
    color: #89b4fa;
  }

  .controls {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  .auto-refresh {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85em;
    color: #a6adc8;
  }

  .controls button {
    padding: 6px 12px;
    background: #45475a;
    border: none;
    border-radius: 6px;
    color: #cdd6f4;
    cursor: pointer;
    font-size: 0.85em;
    transition: background 0.2s;
  }

  .controls button:hover:not(:disabled) {
    background: #585b70;
  }

  .controls button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error-message {
    background: #45000a;
    border: 1px solid #f38ba8;
    border-radius: 8px;
    padding: 12px;
    color: #f38ba8;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #6c7086;
  }

  .empty-state .hint {
    font-size: 0.85em;
    margin-top: 8px;
  }

  .status-summary {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 16px;
  }

  .status-badge {
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8em;
    font-weight: 600;
  }

  .time-info {
    font-size: 0.85em;
    color: #a6adc8;
  }

  .agent-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .agent-card {
    background: #313244;
    border-radius: 8px;
    overflow: hidden;
    transition: box-shadow 0.3s;
  }

  .agent-card.running {
    box-shadow: 0 0 0 2px #89b4fa;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.8;
    }
  }

  .agent-header {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.2s;
  }

  .agent-header:hover {
    background: #45475a;
  }

  .agent-name {
    flex: 1;
    font-weight: 500;
  }

  .agent-status {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.75em;
    margin-right: 12px;
  }

  .expand-icon {
    color: #6c7086;
  }

  .agent-summary {
    padding: 0 16px 12px;
    font-size: 0.85em;
    color: #a6adc8;
  }

  .log-entries {
    background: #1e1e2e;
    border-top: 1px solid #45475a;
    /* max-height removed to allow horizontal scroll */
    display: flex; /* Horizontal layout */
    overflow-x: auto; /* Horizontal scroll */
    overflow-y: hidden;
    gap: 12px;
    padding: 16px; /* Add padding for scroll/shadow space */
    scroll-snap-type: x mandatory; /* Optional: snap to cards */
  }

  .log-entry {
    display: flex;
    flex-direction: column; /* Vertical content within horizontal card */
    gap: 8px;
    padding: 12px;
    border: 1px solid #45475a; /* Full border for card look */
    border-radius: 8px; /* Rounded corners */
    font-size: 0.85em;
    min-width: 300px; /* Fixed width for cards */
    max-width: 300px;
    flex-shrink: 0; /* Prevent shrinking */
    background: #181825; /* Slightly darker background for cards */
    scroll-snap-align: start;
    height: 100%; /* Match height */
  }

  .log-entry.warning {
    background: rgba(249, 226, 175, 0.05);
    border-color: rgba(249, 226, 175, 0.2);
  }

  .log-entry.error {
    background: rgba(243, 139, 168, 0.05);
    border-color: rgba(243, 139, 168, 0.2);
  }

  .log-entry.success {
    background: rgba(166, 227, 161, 0.05);
    border-color: rgba(166, 227, 161, 0.2);
  }

  .log-time {
    color: #6c7086;
    font-size: 0.8em;
    margin-bottom: 4px;
  }

  .log-icon {
    width: auto;
    text-align: left;
    margin-bottom: 4px;
    font-size: 1.2em;
  }

  .log-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .log-action {
    font-weight: 600;
    color: #89b4fa;
    font-size: 1em;
  }

  .log-detail {
    color: #bac2de;
    line-height: 1.4;
    word-break: break-word; /* Prevent overflow */
  }

  .log-duration {
    font-size: 0.8em;
    color: #a6adc8;
    margin-top: auto; /* Push to bottom if needed */
    padding-top: 8px;
    border-top: 1px dashed #45475a;
  }

  .log-data {
    margin-top: 8px;
  }

  .log-data summary {
    cursor: pointer;
    color: #89b4fa;
    font-size: 0.85em;
  }

  .log-data pre {
    background: #11111b;
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.8em;
    margin-top: 8px;
  }

  .orchestrator-summary {
    margin-top: 20px;
    background: #313244;
    border-radius: 8px;
    padding: 16px;
  }

  .orchestrator-summary h4 {
    margin: 0 0 16px 0;
    color: #f9e2af;
  }

  .summary-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 16px;
  }

  .summary-item {
    display: flex;
    gap: 8px;
  }

  .summary-item .label {
    color: #a6adc8;
    min-width: 120px;
  }

  .summary-item .value {
    color: #cdd6f4;
  }

  .findings-section,
  .warnings-section,
  .errors-section,
  .hitl-section,
  .next-steps-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #45475a;
  }

  .orchestrator-summary h5 {
    margin: 0 0 8px 0;
    font-size: 0.95em;
  }

  .findings-section h5 {
    color: #89dceb;
  }
  .warnings-section h5 {
    color: #f9e2af;
  }
  .errors-section h5 {
    color: #f38ba8;
  }
  .hitl-section h5 {
    color: #cba6f7;
  }
  .next-steps-section h5 {
    color: #a6e3a1;
  }

  .orchestrator-summary ul {
    margin: 0;
    padding-left: 24px;
  }

  .orchestrator-summary li {
    margin: 4px 0;
    font-size: 0.9em;
    line-height: 1.5;
  }

  /* Scrollable lists for long summaries */
  .orchestrator-summary ul {
    max-height: 300px;
    overflow-y: auto;
    padding-right: 8px; /* Space for scrollbar */
  }

  /* Scrollable log details */
  .log-detail {
    color: #bac2de;
    line-height: 1.4;
    word-break: break-word;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 4px;
  }

  /* Custom Scrollbar Styling */
  .orchestrator-summary ul::-webkit-scrollbar,
  .log-detail::-webkit-scrollbar {
    width: 6px;
  }

  .orchestrator-summary ul::-webkit-scrollbar-track,
  .log-detail::-webkit-scrollbar-track {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 3px;
  }

  .orchestrator-summary ul::-webkit-scrollbar-thumb,
  .log-detail::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }

  .bg-blue-100 {
    background: rgba(137, 180, 250, 0.2);
  }
  .text-blue-800 {
    color: #89b4fa;
  }
  .bg-green-100 {
    background: rgba(166, 227, 161, 0.2);
  }
  .text-green-800 {
    color: #a6e3a1;
  }
  .bg-red-100 {
    background: rgba(243, 139, 168, 0.2);
  }
  .text-red-800 {
    color: #f38ba8;
  }
  .bg-yellow-100 {
    background: rgba(249, 226, 175, 0.2);
  }
  .text-yellow-800 {
    color: #f9e2af;
  }
  .bg-gray-100 {
    background: rgba(108, 112, 134, 0.2);
  }
  .text-gray-800 {
    color: #6c7086;
  }
</style>
