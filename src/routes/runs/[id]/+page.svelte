<script lang="ts">
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import type {
    StageEvent,
    InsightsAnswerSet,
    HITLPacket,
    SSEMessage,
  } from "$lib/types";
  import RunSummary from "$lib/components/RunSummary.svelte";
  import RunLogStream from "$lib/components/RunLogStream.svelte";
  import DebugPanel from "$lib/components/DebugPanel.svelte";

  // State (Svelte 5 Runes)
  let finalAnswer: InsightsAnswerSet | null = $state(null);
  let hitlPacket: HITLPacket | null = $state(null);

  // Helper for logging to debug panel
  const dlog = (type: any, msg: string, data?: any) => {
    if (typeof window !== "undefined" && (window as any).__JUJU_DEBUG__) {
      (window as any).__JUJU_DEBUG__.log(type, msg, data);
    }
  };
  let status:
    | "loading"
    | "pending"
    | "running"
    | "completed"
    | "hitl"
    | "error"
    | "rejected" = $state("loading");
  let connectedModel: string | null = $state(null);
  let storageProvider: "SUPABASE" | "LOCAL" | null = $state(null);
  let logs: any[] = $state([]); // Store log entries locally

  const runId = $page.params.id;
  let eventSource: EventSource | null = null;

  // Handler
  function handleSSEMessage(data: SSEMessage) {
    dlog("sse", `Received: ${data.type}`, data.payload);
    if (data.type === "completed") {
      const payload = data.payload as { message?: string };
      if (payload.message?.startsWith("Connected")) {
        // Connection handshake
        const match = payload.message.match(/AI Model: (.+)$/);
        if (match) connectedModel = match[1];
        return;
      }

      // If run completed message
      if (status !== "error") status = "completed";
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
      return;
    }

    switch (data.type) {
      case "stage_event":
        status = "running";
        const event = data.payload as StageEvent;
        if (event.next_action === "HITL") status = "hitl";
        if (event.next_action === "REJECT") status = "rejected";
        break;

      case "final_answer":
        finalAnswer = data.payload as InsightsAnswerSet;
        status = "completed";
        break;

      case "hitl_required":
        hitlPacket = data.payload as HITLPacket;
        status = "hitl";
        break;

      case "log_entry":
        if (status === "loading" || status === "pending") status = "running";
        logs = [...logs, data.payload];
        break;

      case "error":
        status = "error";
        break;
    }
  }

  // Initial Load
  async function loadInitialData({ light = false }: { light?: boolean } = {}) {
    try {
      const url = light ? `/api/runs/${runId}?light=1` : `/api/runs/${runId}`;
      dlog("api", `Fetching run metadata: ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error("Run not found");
      const data = await response.json();
      dlog("api", `Current run status: ${data.run.status}`, data.run);

      // Update status ONLY if not already in terminal state
      if (
        status !== "completed" &&
        status !== "error" &&
        status !== "rejected" &&
        status !== "hitl"
      ) {
        if (data.run.status) status = data.run.status;
      }
      if (data.run.model) connectedModel = data.run.model;
      if (data.run.storageProvider) storageProvider = data.run.storageProvider;

      // Load existing logs to populate pipeline (Only on full load)
      if (!light && logs.length === 0) {
        try {
          dlog("api", `Fetching logs: /api/runs/${runId}/logs`);
          const logRes = await fetch(`/api/runs/${runId}/logs`);
          if (logRes.ok) {
            const logData = await logRes.json();
            dlog(
              "api",
              `Loaded ${logData.data?.agents?.length || 0} agents' logs`,
            );
            // Flatten AgentLogCollection[] to LogEntry[]
            if (logData.data && logData.data.agents) {
              const flatLogs: any[] = [];
              logData.data.agents.forEach((agentCol: any) => {
                if (agentCol.logs) {
                  flatLogs.push(...agentCol.logs);
                }
              });

              // Sort safe:
              flatLogs.sort(
                (a, b) =>
                  new Date(a.timestamp).getTime() -
                  new Date(b.timestamp).getTime(),
              );

              logs = flatLogs;
            }
          }
        } catch (err) {
          console.warn("Failed to fetch existing logs:", err);
        }
      }

      if (!light && data.run.status === "completed" && !finalAnswer) {
        const res = await fetch(`/api/runs/${runId}/result`);
        if (res.ok) {
          const r = await res.json();
          finalAnswer = r.result;
        } else {
          dlog("error", "Result not available yet", { status: res.status });
        }
      }

      // If still pending, trigger execution (Self-healing for Vercel cold starts/missed triggers)
      if (!light && data.run.status === "pending") {
        dlog("poll", "Run is pending, triggering execution...");
        fetch(`/api/runs/${runId}/execute`, { method: "POST" }).catch((err) =>
          dlog("error", "Failed to trigger execution", err),
        );
      }

      // If completed but result missing, retry once to load result
      if (!light && data.run.status === "completed" && !finalAnswer) {
        dlog("poll", "Run completed but result missing, retrying result fetch");
        const retry = await fetch(`/api/runs/${runId}/result`);
        if (retry.ok) {
          const rr = await retry.json();
          finalAnswer = rr.result;
        }
      }
    } catch (e) {
      status = "error";
      dlog("error", "Failed to load initial data", e);
    }
  }

  let pollInterval: any;

  function connectSSE() {
    if (eventSource) eventSource.close();
    dlog("sse", `Connecting: /api/runs/${runId}/events`);
    eventSource = new EventSource(`/api/runs/${runId}/events`);
    eventSource.onmessage = (e) => handleSSEMessage(JSON.parse(e.data));
    eventSource.onopen = () => {
      dlog("sse", "Connection established");
      console.log("[SSE] Connected");
      // Stop polling if SSE is working (optional, but keep for safety)
      // Actually, keep polling since Vercel SSE can be flaky or hits different instances
    };
    eventSource.onerror = () => {
      dlog("error", "SSE Error or connection lost");
      console.warn("[SSE] Error or connection lost");
      if (status === "running") {
        // Don't set to error immediately, let polling try
      }
    };
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    dlog("poll", "Polling started (5s interval)");
    pollInterval = setInterval(async () => {
      if (
        status === "completed" ||
        status === "error" ||
        status === "rejected"
      ) {
        if (pollInterval) clearInterval(pollInterval);
        if (eventSource) eventSource.close();
        return;
      }
      dlog("poll", "Polling triggered");
      // console.log("[Polling] Fetching updates..."); // Reduce noise
      await loadInitialData({ light: true });

      // Check again after load to stop immediately if changed
      const currentStatus = status as string;
      if (
        currentStatus === "completed" ||
        currentStatus === "error" ||
        currentStatus === "rejected"
      ) {
        if (pollInterval) clearInterval(pollInterval);
        if (eventSource) eventSource.close();
      }
    }, 5000); // Poll every 5 seconds
  }

  onMount(() => {
    const init = async () => {
      await loadInitialData();
      if (
        status === "running" ||
        status === "loading" ||
        status === "pending"
      ) {
        connectSSE();
        startPolling();
      } else {
        console.log("Run already finished, skipping SSE/Polling");
      }
    };

    init();

    // Cleanup session when user closes window during analysis
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (status === "running" || status === "loading") {
        // Close SSE connection
        eventSource?.close();

        // Optional: Send cleanup request to server (non-blocking)
        navigator.sendBeacon(`/api/runs/${runId}/cancel`);

        // Show warning to user
        e.preventDefault();
        e.returnValue = "분석이 진행 중입니다. 정말 종료하시겠습니까?";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup on component destroy
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  });

  onDestroy(() => {
    eventSource?.close();
    if (pollInterval) clearInterval(pollInterval);
  });

  // Determine active agent (Svelte 5 Derived)
  let activeAgent = $derived(
    (() => {
      // If we have stage event, use that
      const stageMap: Record<string, string> = {
        B: "B_Gatekeeper",
        C: "C_Extractor",
        D: "D_Normalizer",
        E: "E_Validator",
        INSIGHTS: "INS_Analyst",
        FastExtractor: "FastExtractor",
      };

      // Check logs for latest agent if no better info
      if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        if (lastLog && lastLog.agent) return lastLog.agent;
      }

      return null;
    })(),
  );
</script>

<svelte:head>
  <title>분석 진행상황 - JuJu</title>
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
  />
</svelte:head>

<main class="page-container">
  <!-- Navigation Bar -->
  <nav class="nav-bar">
    <button
      type="button"
      class="home-btn"
      onclick={() => {
        // 1. SSE 연결 해제
        eventSource?.close();
        if (pollInterval) clearInterval(pollInterval);

        // 2. 세션 스토리지 초기화
        sessionStorage.removeItem("currentRunId");
        sessionStorage.removeItem("lastAnalysisResult");

        // 3. 디버그 패널 초기화
        if ((window as any).__JUJU_DEBUG__) {
          (window as any).__JUJU_DEBUG__.clear?.();
        }

        dlog("info", "Session cleared, navigating home");

        // 4. 홈으로 이동
        window.location.href = "/";
      }}>← Home</button
    >
    <span class="run-id">#{runId?.slice(0, 8)}</span>
  </nav>

  <!-- Content Grid -->
  <div class="content-grid">
    <!-- Agent Pipeline Logs (Top) -->
    <section class="top-panel">
      <RunLogStream {logs} {activeAgent} runStatus={status} />
    </section>

    <!-- Summary & Results (Bottom) -->
    <section class="bottom-panel">
      <RunSummary
        {status}
        {finalAnswer}
        {connectedModel}
        {storageProvider}
        hitlId={hitlPacket?.id}
      />
    </section>
  </div>

  <!-- Debug Monitor (Hidden by default, triggered by 🐞) -->
  <DebugPanel {runId} />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    /* Background handled by layout.css var(--fluent-bg-solid) */
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
  }

  .page-container {
    display: flex;
    flex-direction: column;
    height: 100vh; /* Fallback */
    height: 100dvh; /* Mobile friendly */
    width: 100vw;
    overflow: hidden;
  }

  .nav-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem 1.5rem;
    background: rgba(20, 20, 30, 0.9); /* Dark glass */
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--fluent-border-default);
    flex-shrink: 0;
    z-index: 10;
  }

  .home-btn {
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: none;
    color: var(--fluent-text-secondary);
    font-size: 0.9rem;
    font-weight: 500;
    transition: color 0.2s;
    padding: 0;
  }

  .home-btn:hover {
    color: var(--fluent-accent-light); /* Lighter blue on hover */
  }

  .run-id {
    font-family: "Courier New", monospace;
    color: var(--fluent-text-tertiary);
    font-size: 0.85rem;
    background: rgba(255, 255, 255, 0.05); /* Restore slight transparency */
    border: 1px solid var(--fluent-border-subtle);
    padding: 4px 10px;
    border-radius: 6px;
  }

  /* Content Grid - Vertical Stack */
  .content-grid {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
    flex: 1; /* Take remaining space correctly */
    min-height: 0; /* Important for nested flex scrolling */
    overflow-y: auto;
    width: 100%;
    box-sizing: border-box;
    padding-bottom: 200px; /* Increased padding to ensure footer is visible */
  }

  @media (min-width: 1024px) {
    .content-grid {
      padding: 1.5rem 2rem;
      padding-bottom: 200px; /* Force restore bottom padding for PC */
      gap: 2rem;
      max-width: 600px; /* Standardize to 600px even on PC for unified look */
      margin: 0 auto;
    }
  }

  /* Logs section (Top) */
  .top-panel {
    flex: 0 0 auto; /* Height by content */
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    min-height: 480px; /* Give logs some height */
    display: flex;
    flex-direction: column;
  }

  /* Summary section (Bottom) */
  .bottom-panel {
    flex: 0 0 auto; /* Don't grow, let it take natural height */
    width: 100%;
    max-width: 600px;
    margin: 0 auto;
    padding-bottom: 2rem;
  }
</style>
