<!-- File: src/routes/+page.svelte -->
<script lang="ts">
  import { goto } from "$app/navigation";
  import UploadPanel from "$lib/components/UploadPanel.svelte";
  import DebugPanel from "$lib/components/DebugPanel.svelte";

  interface RunItem {
    id: string;
    status: string;
    fileCount: number;
    currentStage?: string;
    createdAt: string;
  }

  let recentRuns: RunItem[] = $state([]);
  let loading = $state(true);
  let useSupabase = $state(false);

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
    event: CustomEvent<{ runId: string; mode: string }>,
  ) {
    const { runId, mode } = event.detail;

    // 백그라운드 서버리스/인라인 실행 트리거
    try {
      await fetch(`/api/runs/${runId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, useSupabase }),
      });
    } catch (error) {
      console.warn("[Home] Execute request failed, navigating anyway", error);
    }

    goto(`/runs/${runId}`); // Client-side navigation
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

  /**
   * 세션 초기화 - 홈 진입 시 이전 분석 컨텍스트 클리어
   */
  function clearPreviousSession() {
    // 1. SessionStorage/LocalStorage에서 이전 run 관련 데이터 제거
    if (typeof window !== "undefined") {
      sessionStorage.removeItem("currentRunId");
      sessionStorage.removeItem("lastAnalysisResult");

      // 2. 디버그 패널 로그 초기화
      if ((window as any).__JUJU_DEBUG__) {
        (window as any).__JUJU_DEBUG__.clear?.();
      }

      console.log("[Home] Previous session cleared");
    }
  }

  // 페이지 로드 시 실행
  $effect(() => {
    clearPreviousSession(); // 세션 초기화
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

  <!-- Storage Toggle -->
  <div class="storage-toggle-wrapper">
    <div class="storage-segmented-control">
      <label class="segment-label" class:active={!useSupabase}>
        <input
          type="radio"
          name="storageMode"
          value={false}
          bind:group={useSupabase}
        />
        <span class="icon">💻</span>
        <span class="text">Local 저장소</span>
      </label>
      <label class="segment-label supabase" class:active={useSupabase}>
        <input
          type="radio"
          name="storageMode"
          value={true}
          bind:group={useSupabase}
        />
        <span class="icon">☁️</span>
        <span class="text">Supabase 연동</span>
      </label>
      <div class="segment-pill" class:supabase-active={useSupabase}></div>
    </div>
    <div class="storage-hint">
      {#if !useSupabase}
        <span class="hint local"
          >PC 내부 경로에 파일을 저장하고 분석합니다.</span
        >
      {:else}
        <span class="hint cloud"
          >Supabase Storage 클라우드를 사용하여 파일을 저장합니다.</span
        >
      {/if}
    </div>
  </div>

  <!-- Upload Section -->
  <section class="upload-section">
    <UploadPanel {useSupabase} on:uploaded={handleUploaded} />
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
    <button
      type="button"
      class="reset-storage-btn"
      onclick={async () => {
        if (
          !confirm(
            "⚠️ 모든 분석 기록과 업로드된 파일이 삭제됩니다.\n정말 초기화하시겠습니까?",
          )
        )
          return;

        try {
          const response = await fetch("/api/storage/reset", {
            method: "POST",
          });
          const result = await response.json();

          if (response.ok) {
            alert(
              `✅ 저장소 초기화 완료\n삭제된 파일: ${result.deletedFiles}개`,
            );
            recentRuns = [];
          } else {
            alert("❌ 초기화 실패: " + (result.error || "Unknown error"));
          }
        } catch (e) {
          alert(
            "❌ 초기화 실패: " +
              (e instanceof Error ? e.message : "Network error"),
          );
        }
      }}>🗑️ 저장소 초기화</button
    >
    <p>Powered by OpenAI Agents SDK · GPT-4o</p>
  </footer>

  <!-- Hidden Debug Panel -->
  <DebugPanel />
</main>

<style>
  .home {
    max-width: 600px; /* Standardize to 600px as per Design System */
    margin: 0 auto;
    padding: 24px 16px 48px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center; /* Center align children */
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
    border: 1px solid var(--fluent-border-default);
    box-shadow: var(--fluent-shadow-4); /* Stronger shadow */
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
    width: 100%;
  }

  /* Storage Toggle - Segmented Control */
  .storage-toggle-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-bottom: 32px;
  }

  .storage-segmented-control {
    position: relative;
    display: flex;
    background: var(--fluent-bg-layer);
    border: 1px solid var(--fluent-border-subtle);
    border-radius: 999px;
    padding: 4px;
    width: fit-content;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
    z-index: 1;
  }

  .segment-label {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 24px;
    cursor: pointer;
    z-index: 2;
    border-radius: 999px;
    transition: color 0.3s ease;
    color: var(--fluent-text-secondary);
  }

  .segment-label input {
    display: none;
  }

  .segment-label .icon {
    font-size: 16px;
    opacity: 0.7;
    transition: opacity 0.3s;
    filter: grayscale(1);
  }

  .segment-label .text {
    font-size: 14px;
    font-weight: 600;
  }

  .segment-label.active {
    color: #0f172a;
  }

  .segment-label.active .icon {
    opacity: 1;
    filter: grayscale(0);
  }

  .segment-label.supabase.active {
    color: #fff;
  }

  .segment-pill {
    position: absolute;
    top: 4px;
    bottom: 4px;
    left: 4px;
    width: calc(50% - 4px);
    background: #fff;
    border-radius: 999px;
    box-shadow:
      0 2px 5px rgba(0, 0, 0, 0.1),
      0 1px 2px rgba(0, 0, 0, 0.05);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    z-index: 1;
  }

  .segment-pill.supabase-active {
    transform: translateX(100%);
    background: linear-gradient(
      135deg,
      #3ecf8e 0%,
      #35b37e 100%
    ); /* Supabase green */
  }

  .storage-hint {
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hint {
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s;
  }

  .hint.local {
    color: var(--fluent-accent);
  }

  .hint.cloud {
    color: #3ecf8e;
  }

  /* Recent Runs */
  .recent-runs {
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
    background: var(--fluent-bg-layer); /* Distinct layer */
    border: 1px solid var(--fluent-border-subtle);
    border-radius: var(--fluent-radius-m);
    text-decoration: none;
    transition: all var(--fluent-duration-fast) var(--fluent-easing);
    box-shadow: var(--fluent-shadow-2);
  }

  .run-item:hover {
    background: var(--fluent-bg-card);
    border-color: var(--fluent-accent); /* Blue border on hover */
    transform: translateY(-1px);
    box-shadow: var(--fluent-shadow-4);
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
    background: var(--fluent-bg-smoke);
    color: var(--fluent-text-tertiary);
    border: 1px solid var(--fluent-border-subtle);
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

  .reset-storage-btn {
    padding: 8px 16px;
    margin-bottom: 16px;
    background: rgba(220, 53, 69, 0.1);
    border: 1px solid rgba(220, 53, 69, 0.3);
    border-radius: 8px;
    color: #dc3545;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
  }

  .reset-storage-btn:hover {
    background: rgba(220, 53, 69, 0.2);
    border-color: #dc3545;
  }
</style>
