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

  // State (Svelte 5 Runes)
  let finalAnswer: InsightsAnswerSet | null = $state(null);
  let hitlPacket: HITLPacket | null = $state(null);
  let status:
    | "loading"
    | "pending"
    | "running"
    | "completed"
    | "hitl"
    | "error"
    | "rejected" = $state("loading");
  let connectedModel: string | null = $state(null);
  let logs: any[] = $state([]); // Store log entries locally

  const runId = $page.params.id;
  let eventSource: EventSource | null = null;

  // Handler
  function handleSSEMessage(data: SSEMessage) {
    if (data.type === "completed") {
      const payload = data.payload as { message?: string };
      if (payload.message?.startsWith("Connected")) {
        // Connection handshake
        const match = payload.message.match(/AI Model: (.+)$/);
        if (match) connectedModel = match[1];
        return;
      }
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

      case "completed":
        if (status !== "error") status = "completed";
        break;
    }
  }

  // Initial Load
  async function loadInitialData() {
    try {
      const response = await fetch(`/api/runs/${runId}`);
      if (!response.ok) throw new Error("Run not found");
      const data = await response.json();

      status = data.run.status;
      if (data.run.model) connectedModel = data.run.model;

      // Load existing logs to populate pipeline
      try {
        const logRes = await fetch(`/api/runs/${runId}/logs`);
        if (logRes.ok) {
          const logData = await logRes.json();
          // Flatten AgentLogCollection[] to LogEntry[]
          if (logData.data && logData.data.agents) {
            const flatLogs: any[] = [];
            logData.data.agents.forEach((agentCol: any) => {
              if (agentCol.logs) {
                flatLogs.push(...agentCol.logs);
              }
            });
            // Sort by timestamp if needed, though they might be ordered.
            // Agent logs might be interleaved in time but grouped by agent in the response?
            // Actually RunLogReport groups by agent. If we flatten, we might lose time order if we just concat.
            // But RunLogStream groups by agent anyway!
            // So order of *blocks* matters.
            // If the report is ordered by agent execution, we are good.
            // Let's trust the report order or sort by timestamp.
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

      if (data.run.status === "completed") {
        const res = await fetch(`/api/runs/${runId}/result`);
        if (res.ok) {
          const r = await res.json();
          finalAnswer = r.result;
        }
      }
    } catch (e) {
      status = "error";
    }
  }

  function connectSSE() {
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/runs/${runId}/events`);
    eventSource.onmessage = (e) => handleSSEMessage(JSON.parse(e.data));
    eventSource.onopen = () => {
      console.log("[SSE] Connected");
    };
    eventSource.onerror = () => {
      if (status === "running") status = "error";
      eventSource?.close();
    };
  }

  onMount(() => {
    const init = async () => {
      await loadInitialData();
      if (status === "running" || status === "loading" || status === "pending")
        connectSSE();
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
    <a href="/" class="home-btn">← Home</a>
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
        hitlId={hitlPacket?.id}
      />
    </section>
  </div>
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
    text-decoration: none;
    color: var(--fluent-text-secondary);
    font-size: 0.9rem;
    font-weight: 500;
    transition: color 0.2s;
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
