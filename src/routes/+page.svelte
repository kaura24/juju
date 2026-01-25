<!-- File: src/routes/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import UploadPanel from "$lib/components/UploadPanel.svelte";

  interface RunItem {
    id: string;
    status: string;
    fileCount: number;
    currentStage?: string;
    createdAt: string;
  }

  let recentRuns: RunItem[] = $state([]);
  let loading = $state(true);

  async function loadRuns() {
    try {
      const response = await fetch("/api/runs");
      if (response.ok) {
        const data = await response.json();
        recentRuns = data.runs.slice(0, 5);
      }
    } catch (error) {
      console.error("Failed to load runs:", error);
    } finally {
      loading = false;
    }
  }

  async function handleUploaded(
    event: CustomEvent<{ runId: string; mode: "FAST" | "MULTI_AGENT" }>,
  ) {
    const { runId, mode } = event.detail;

    // 실행 시작 (모드 전달)
    await fetch(`/api/runs/${runId}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });

    // 상세 페이지로 이동
    goto(`/runs/${runId}`);
  }

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getStatusInfo(status: string): {
    icon: string;
    label: string;
    class: string;
  } {
    switch (status) {
      case "completed":
        return { icon: "✓", label: "완료", class: "success" };
      case "running":
        return { icon: "●", label: "분석중", class: "running" };
      case "hitl":
        return { icon: "!", label: "HITL", class: "warning" };
      case "rejected":
        return { icon: "✕", label: "거부", class: "error" };
      case "error":
        return { icon: "✕", label: "오류", class: "error" };
      default:
        return { icon: "○", label: "대기", class: "pending" };
    }
  }

  // System Status
  interface SystemStatus {
    status: "connected" | "disconnected" | "mock" | "error";
    model: string;
    fallbackModel?: string;
    error?: string;
  }

  let systemStatus: SystemStatus | null = $state(null);

  async function loadSystemStatus() {
    try {
      const response = await fetch("/api/system-status");
      if (response.ok) {
        systemStatus = await response.json();
      }
    } catch (e) {
      console.error("Failed to load system status", e);
    }
  }

  // 페이지 로드 시 실행
  $effect(() => {
    loadRuns();
    loadSystemStatus();
  });
</script>

<svelte:head>
  <title>JuJu - 주주명부 AI 분석</title>
</svelte:head>

<main class="home">
  <!-- System Status Bar -->
  {#if systemStatus}
    <div class="system-status-bar {systemStatus.status}">
      <div class="status-dot"></div>
      <span class="status-text">
        {#if systemStatus.status === "connected"}
          AI 연결됨 ({systemStatus.model})
        {:else if systemStatus.status === "mock"}
          MOCK 모드 ({systemStatus.model})
        {:else}
          AI 연결 안됨
        {/if}
      </span>
    </div>
  {/if}

  <h1 class="page-title">JuJu Analysis</h1>

  <!-- Upload Section -->
  <section class="upload-section">
    <UploadPanel on:uploaded={handleUploaded} />
  </section>

  <!-- Recent Runs Section -->
  {#if !loading && recentRuns.length > 0}
    <section class="recent-runs">
      <div class="section-header">
        <h2>최근 분석</h2>
        <div class="links">
          <a href="/runs/monitor" class="monitor-link">🖥️ 모니터 모드</a>
          <a href="/runs" class="view-all-link">전체 보기</a>
        </div>
      </div>

      <div class="run-list">
        {#each recentRuns as run}
          {@const statusInfo = getStatusInfo(run.status)}
          <a href="/runs/{run.id}" class="run-item">
            <div class="status-indicator {statusInfo.class}">
              <span>{statusInfo.icon}</span>
            </div>
            <div class="run-info">
              <span class="run-id">{run.id.slice(0, 8)}</span>
              <span class="run-stage">{run.currentStage || "대기"}</span>
            </div>
            <div class="run-meta">
              <span class="status-label">{statusInfo.label}</span>
              <span class="run-time">{formatTime(run.createdAt)}</span>
            </div>
            <div class="arrow-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Footer -->
  <footer class="footer">
    <p>Powered by OpenAI Agents SDK · GPT-4o</p>
  </footer>
</main>

<style>
  .home {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 24px 48px;
    min-height: 100vh;
  }

  /* System Status Bar */
  .system-status-bar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 500;
    margin: 0 auto 32px;
    background: var(--fluent-bg-card);
    border: 1px solid var(--fluent-border-subtle);
    display: flex;
    width: fit-content;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .system-status-bar.connected .status-dot {
    background-color: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  .system-status-bar.mock .status-dot {
    background-color: #f59e0b;
  }

  .system-status-bar.disconnected .status-dot,
  .system-status-bar.error .status-dot {
    background-color: #ef4444;
  }

  .status-text {
    color: var(--fluent-text-secondary);
  }

  /* Page Title */
  .page-title {
    font-size: 32px;
    font-weight: 700;
    color: var(--fluent-text-primary);
    text-align: center;
    margin: 0 0 32px;
    letter-spacing: -0.02em;
  }

  /* Upload Section */
  .upload-section {
    margin-bottom: 64px;
  }

  /* Recent Runs */
  .recent-runs {
    background: var(--fluent-bg-card);
    border: 1px solid var(--fluent-border-subtle);
    border-radius: var(--fluent-radius-l);
    padding: 20px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .section-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--fluent-text-primary);
    margin: 0;
  }

  .view-all-link {
    font-size: 13px;
    color: var(--fluent-accent-light);
    text-decoration: none;
  }

  .view-all-link:hover {
    text-decoration: underline;
  }

  .links {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .monitor-link {
    font-size: 13px;
    color: var(--fluent-accent-light);
    text-decoration: none;
    font-weight: 600;
    padding: 4px 12px;
    background: rgba(59, 130, 246, 0.1);
    border-radius: 999px;
    transition: all 0.2s;
  }

  .monitor-link:hover {
    background: rgba(59, 130, 246, 0.2);
    transform: translateY(-1px);
  }

  .run-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .run-item {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent;
    border-radius: var(--fluent-radius-m);
    text-decoration: none;
    transition: all var(--fluent-duration-fast) var(--fluent-easing);
  }

  .run-item:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--fluent-border-default);
  }

  .status-indicator {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--fluent-radius-s);
    font-size: 14px;
    font-weight: 600;
  }

  .status-indicator.success {
    background: rgba(15, 123, 15, 0.15);
    color: #6ccb5f;
  }

  .status-indicator.running {
    background: rgba(0, 120, 212, 0.15);
    color: var(--fluent-accent-light);
    animation: pulse 1.5s infinite;
  }

  .status-indicator.warning {
    background: rgba(157, 93, 0, 0.15);
    color: #fce100;
  }

  .status-indicator.error {
    background: rgba(196, 43, 28, 0.15);
    color: #ff99a4;
  }

  .status-indicator.pending {
    background: rgba(255, 255, 255, 0.05);
    color: var(--fluent-text-tertiary);
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .run-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .run-id {
    font-family: var(--fluent-font-mono);
    font-size: 13px;
    color: var(--fluent-text-primary);
  }

  .run-stage {
    font-size: 12px;
    color: var(--fluent-accent-light);
  }

  .run-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .status-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--fluent-text-secondary);
  }

  .run-time {
    font-size: 11px;
    color: var(--fluent-text-tertiary);
  }

  .arrow-icon {
    color: var(--fluent-text-tertiary);
    opacity: 0;
    transition: all var(--fluent-duration-fast);
  }

  .run-item:hover .arrow-icon {
    opacity: 1;
    transform: translateX(4px);
  }

  /* Footer */
  .footer {
    text-align: center;
    margin-top: 64px;
    padding-top: 24px;
    border-top: 1px solid var(--fluent-border-subtle);
  }

  .footer p {
    font-size: 12px;
    color: var(--fluent-text-tertiary);
    margin: 0;
  }
</style>
