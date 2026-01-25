<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { goto } from "$app/navigation";
    import { scale, fade, fly } from "svelte/transition";
    import StageCard from "$lib/components/StageCard.svelte";
    import type { StageEvent, StageName, SSEMessage } from "$lib/types";

    // 상태 관리
    let runs: any[] = $state([]);
    let currentRunIndex = $state(0);
    let currentRunId: string | null = $state(null);
    let status:
        | "loading"
        | "running"
        | "completed"
        | "hitl"
        | "error"
        | "rejected"
        | "waiting" = $state("loading");

    let events: StageEvent[] = $state([]);
    let eventSource: EventSource | null = null;
    let autoAdvanceTimer: any = null;
    let countdown = $state(0);

    // 현재 활성 이벤트 (가장 최근 것)
    const currentEvent = $derived(
        events.length > 0 ? events[events.length - 1] : null,
    );

    async function loadRuns() {
        try {
            const response = await fetch("/api/runs");
            if (response.ok) {
                const data = await response.json();
                // 활성 상태인 런만 필터링 (완료된 것은 제외)
                // 모니터 모드는 현재 진행 중인 작업을 보여주는 것이 목적
                runs = data.runs.filter((r: any) =>
                    ["running", "loading", "pending", "hitl"].includes(
                        r.status,
                    ),
                );

                if (runs.length > 0) {
                    startRunMonitoring(0);
                } else {
                    status = "waiting";
                }
            }
        } catch (e) {
            console.error("Failed to load runs", e);
            status = "error";
        }
    }

    function startRunMonitoring(index: number) {
        if (index >= runs.length) {
            // 그 다음 런이 없으면 다시 목록을 갱신해본다
            console.log("Queue finished, refreshing...");
            loadRuns();
            return;
        }

        currentRunIndex = index;
        currentRunId = runs[index].id;
        status = "loading";
        events = []; // 이벤트 초기화

        // 이 Run의 상세 정보를 로드 (이미 완료된 상태일 수도 있음)
        loadRunDetails(currentRunId!);
    }

    async function loadRunDetails(runId: string) {
        try {
            const response = await fetch(`/api/runs/${runId}`);
            if (!response.ok) throw new Error("Run not found");

            const data = await response.json();
            events = data.events || [];

            const runStatus = data.run.status;

            // 이미 완료된 경우
            if (["completed", "rejected", "error"].includes(runStatus)) {
                status = runStatus as any;
                scheduleAutoAdvance();
            } else {
                // 진행 중인 경우 SSE 연결
                status = "running";
                if (runStatus === "hitl") status = "hitl";
                connectSSE(runId);
            }
        } catch (e) {
            console.error("Failed to load run details", e);
            // 에러 나면 다음으로 넘어감
            scheduleAutoAdvance();
        }
    }

    function connectSSE(runId: string) {
        if (eventSource) eventSource.close();

        eventSource = new EventSource(`/api/runs/${runId}/events`);

        eventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data) as SSEMessage;

                if (data.type === "stage_event") {
                    events = [...events, data.payload as StageEvent];
                    status = "running"; // 이벤트 들어오면 running

                    const latest = data.payload as StageEvent;
                    if (latest.next_action === "HITL") status = "hitl";
                    if (latest.next_action === "REJECT") {
                        status = "rejected";
                        scheduleAutoAdvance();
                    }
                } else if (data.type === "final_answer") {
                    status = "completed";
                    scheduleAutoAdvance();
                } else if (data.type === "error") {
                    status = "error";
                    scheduleAutoAdvance();
                } else if (data.type === "hitl_required") {
                    status = "hitl";
                    // HITL은 자동 진행하지 않음 (사람 개입 필요)
                }
            } catch (err) {
                console.error("SSE Parse Error", err);
            }
        };

        eventSource.onerror = () => {
            if (
                status !== "completed" &&
                status !== "rejected" &&
                status !== "error"
            ) {
                // 연결 끊김?
                console.log("SSE connection lost");
            }
            eventSource?.close();
        };
    }

    function scheduleAutoAdvance() {
        if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);

        countdown = 5;
        const interval = setInterval(() => {
            countdown--;
            if (countdown <= 0) clearInterval(interval);
        }, 1000);

        autoAdvanceTimer = setTimeout(() => {
            // 다음 런으로 이동
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            startRunMonitoring(currentRunIndex + 1);
        }, 5000);
    }

    onMount(() => {
        loadRuns();

        // Waiting 상태일 때 주기적으로 폴링
        const pollInterval = setInterval(() => {
            if (status === "waiting") {
                loadRuns();
            }
        }, 5000);

        return () => {
            clearInterval(pollInterval);
        };
    });

    onDestroy(() => {
        if (eventSource) eventSource.close();
        if (autoAdvanceTimer) clearTimeout(autoAdvanceTimer);
    });
</script>

<svelte:head>
    <title>JuJu Monitor Mode</title>
</svelte:head>

<div class="monitor-container">
    {#if status === "waiting"}
        <div class="waiting-screen" in:fade>
            <div class="pulse-ring"></div>
            <h1>Waiting for Tasks...</h1>
            <p>새로운 분석 요청을 기다리고 있습니다.</p>
        </div>
    {:else if currentRunId}
        <div class="slide-view" in:fade={{ duration: 300 }}>
            <!-- Header / Progress -->
            <header class="monitor-header">
                <div class="run-info">
                    <span class="run-label">RUN ID</span>
                    <span class="run-id">{currentRunId.slice(0, 8)}</span>
                </div>
                <div class="status-indicator {status}">
                    {status.toUpperCase()}
                </div>

                {#if countdown > 0}
                    <div class="next-timer" transition:scale>
                        Next in {countdown}s
                    </div>
                {/if}
            </header>

            <!-- Main Stage Content -->
            <main class="stage-display">
                {#if events.length === 0}
                    <div class="loading-state">
                        <div class="spinner"></div>
                        <p>Initializing Agents...</p>
                    </div>
                {:else if currentEvent}
                    <!-- Key key={currentEvent.timestamp}  -->
                    {#key currentEvent.timestamp}
                        <div
                            class="stage-card-wrapper"
                            in:fly={{ y: 50, duration: 500 }}
                            out:fade={{ duration: 200 }}
                        >
                            <StageCard event={currentEvent} isLatest={true} />
                        </div>
                    {/key}
                {/if}
            </main>

            <!-- Timeline Dots (Progress) -->
            <footer class="monitor-footer">
                <div class="timeline-dots">
                    {#each events as evt, i}
                        <div
                            class="dot"
                            class:active={i === events.length - 1}
                            title={evt.stage_name}
                        ></div>
                    {/each}
                </div>
                <div class="progress-info">
                    Total {events.length} Steps
                </div>
            </footer>
        </div>
    {/if}
</div>

<style>
    :global(body) {
        margin: 0;
        overflow: hidden; /* 모니터 모드는 스크롤 없음 */
        background: #111116;
    }

    .monitor-container {
        width: 100vw;
        height: 100vh;
        color: white;
        font-family: "Inter", sans-serif;
        display: flex;
        flex-direction: column;
    }

    .waiting-screen {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #0f172a;
    }

    .waiting-screen h1 {
        font-size: 3rem;
        font-weight: 200;
        color: #94a3b8;
        margin-bottom: 1rem;
    }

    .pulse-ring {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        border: 4px solid #3b82f6;
        animation: pulse-ring 2s infinite;
        margin-bottom: 2rem;
    }

    @keyframes pulse-ring {
        0% {
            transform: scale(0.8);
            opacity: 1;
        }
        100% {
            transform: scale(1.5);
            opacity: 0;
        }
    }

    .slide-view {
        flex: 1;
        padding: 2rem;
        display: flex;
        flex-direction: column;
        background: radial-gradient(circle at center, #1e1e2e 0%, #111116 100%);
    }

    .monitor-header {
        display: flex;
        align-items: center;
        gap: 2rem;
        padding-bottom: 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }

    .run-info {
        display: flex;
        flex-direction: column;
    }

    .run-label {
        font-size: 0.8rem;
        color: #94a3b8;
        font-weight: 600;
        letter-spacing: 0.1em;
    }

    .run-id {
        font-family: monospace;
        font-size: 1.5rem;
        color: #e2e8f0;
    }

    .status-indicator {
        padding: 0.5rem 1.5rem;
        border-radius: 9999px;
        font-weight: 800;
        font-size: 1.2rem;
        letter-spacing: 0.05em;
    }

    .status-indicator.running {
        background: rgba(59, 130, 246, 0.2);
        color: #60a5fa;
    }
    .status-indicator.completed {
        background: rgba(16, 185, 129, 0.2);
        color: #34d399;
    }
    .status-indicator.error {
        background: rgba(239, 68, 68, 0.2);
        color: #f87171;
    }
    .status-indicator.hitl {
        background: rgba(245, 158, 11, 0.2);
        color: #fbbf24;
    }

    .next-timer {
        margin-left: auto;
        font-size: 1.2rem;
        color: #94a3b8;
        font-variant-numeric: tabular-nums;
    }

    .stage-display {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        perspective: 1000px;
        padding: 2rem;
    }

    .stage-card-wrapper {
        width: 100%;
        max-width: 900px;
        /* StageCard 스타일 오버라이드 (확대) */
        transform: scale(1.1);
    }

    /* StageCard 내부 폰트 사이즈 키우기 (Global처럼 동작하지만 wrapper 내부만) */
    .stage-card-wrapper :global(.stage-card) {
        min-height: 400px;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .stage-card-wrapper :global(.stage-name) {
        font-size: 2rem !important;
    }
    .stage-card-wrapper :global(.stage-icon) {
        font-size: 3rem !important;
    }
    .stage-card-wrapper :global(.summary) {
        font-size: 1.5rem !important;
        line-height: 1.6;
    }
    .stage-card-wrapper :global(.rationale) {
        font-size: 1.1rem !important;
    }

    .loading-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        opacity: 0.7;
    }

    .spinner {
        width: 60px;
        height: 60px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-top-color: #fff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin-bottom: 1rem;
    }

    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .monitor-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: 2rem;
    }

    .timeline-dots {
        display: flex;
        gap: 1rem;
    }

    .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.2);
        transition: all 0.3s;
    }

    .dot.active {
        background: #00d9ff;
        transform: scale(1.5);
        box-shadow: 0 0 10px #00d9ff;
    }

    .progress-info {
        color: #64748b;
    }
</style>
