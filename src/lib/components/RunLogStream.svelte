<script lang="ts">
    import { onMount } from "svelte";
    import type { AgentLogEntry } from "$lib/server/agentLogger"; // Note: Types imported from server file might be issue if not shared.
    // Ideally types should be in $lib/types. But agentLogger defines AgentLogEntry.
    // If it's not exported to client, we define interface here or move it to types.
    // Assuming strict separation, I'll redefine partial interface or use any.
    // But wait, agentLogger is server-side.

    // Update: I should check if AgentLogEntry is exported in $lib/types. It isn't.
    // I will define a local interface matching it.

    interface LogEntry {
        timestamp: string;
        agent: string;
        level: "INFO" | "SUCCESS" | "WARNING" | "ERROR" | "DEBUG";
        action: string;
        detail: string;
        duration_ms?: number;
    }

    interface Props {
        logs?: LogEntry[];
        activeAgent?: string | null;
        runStatus?: string | null;
    }

    let { logs = [], activeAgent = null, runStatus = null }: Props = $props();

    const scrollToRight = () => {
        // This function previously used scrollContainer, which is now removed.
        // It's likely this function and its call in afterUpdate should also be removed
        // if the intention is to remove the scrolling functionality.
        // However, the instruction only specified removing the variable.
        // To maintain syntactic correctness and avoid runtime errors,
        // I will comment out the body of this function.
        // If the user intended to remove the function entirely, they would have specified.
        // if (scrollContainer) {
        //     scrollContainer.scrollLeft = scrollContainer.scrollWidth;
        // }
    };

    $effect(() => {
        logs; // dependency
        scrollToRight();
    });

    const getIcon = (level: string) => {
        switch (level) {
            case "INFO":
                return "ℹ️";
            case "SUCCESS":
                return "✅";
            case "WARNING":
                return "⚠️";
            case "ERROR":
                return "❌";
            case "DEBUG":
                return "🔧";
            default:
                return "•";
        }
    };

    const getTime = (iso: string) => {
        return new Date(iso).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    };

    // Agent display names mapping
    const agentDisplayNames: Record<string, string> = {
        B_Gatekeeper: "🚪 B: 게이트키퍼",
        C_Extractor: "📄 C: 추출기",
        D_Normalizer: "🔄 D: 정규화기",
        E_Validator: "✅ E: 검증기",
        INS_Analyst: "📊 INSIGHTS: 분석가",
        Orchestrator: "🎯 오케스트레이터",
        FastExtractor: "🚀 Fast Track: 통합 추출기",
    };

    // Logic transformation: Group logs by agent to form "Blocks"
    interface AgentGroup {
        id: string; // Unique ID for keying (e.g. agent name + timestamp index)
        agent: string;
        logs: LogEntry[];
        status: "running" | "completed" | "error" | "pending";
        startTime: string;
    }

    let agentGroups = $derived.by(() => {
        const groups: AgentGroup[] = [];
        let currentGroup: AgentGroup | null = null;

        logs.forEach((log) => {
            // Start a new group if agent changes
            if (!currentGroup || currentGroup.agent !== log.agent) {
                // Determine status of previous group (if any)
                if (currentGroup) {
                    currentGroup.status = "completed"; // Default to completed unless error found
                    // Check for error logs
                    if (currentGroup.logs.some((l) => l.level === "ERROR"))
                        currentGroup.status = "error";
                }

                currentGroup = {
                    id: `${log.agent}-${log.timestamp}`,
                    agent: log.agent,
                    logs: [],
                    status: "running", // Newly created group is running
                    startTime: log.timestamp,
                };
                groups.push(currentGroup);
            }
            currentGroup.logs.push(log);
        });

        // Update status of the very last group based on activeAgent or log content
        if (currentGroup) {
            const group = currentGroup as AgentGroup;
            if (group.logs.some((l) => l.level === "ERROR")) {
                group.status = "error";
            } else if (activeAgent && activeAgent !== group.agent) {
                // If active agent moved on, this group is likely done
                group.status = "completed";
            } else if (runStatus === "completed") {
                // If the entire run is finished, all agents are done
                group.status = "completed";
            } else {
                group.status = "running";
            }
        }

        return groups;
    });

    // Navigation state
    let activeGroupIndex = $state(0);

    // Navigation functions
    const prev = () => {
        if (activeGroupIndex > 0) {
            activeGroupIndex--;
        }
    };

    const next = () => {
        if (activeGroupIndex < agentGroups.length - 1) {
            activeGroupIndex++;
        }
    };

    const scrollToGroup = (index: number) => {
        activeGroupIndex = index;
    };

    // Auto-scroll to running agent
    $effect(() => {
        if (agentGroups.length > 0) {
            const runningIndex = agentGroups.findIndex(
                (g) => g.status === "running",
            );
            if (runningIndex !== -1 && runningIndex !== activeGroupIndex) {
                setTimeout(() => scrollToGroup(runningIndex), 100);
            }
        }
    });
</script>

<div class="pipeline-wrapper">
    <div class="pipeline-container">
        <div class="pipeline-track">
            <!-- Show only active agent card -->
            {#if agentGroups[activeGroupIndex]}
                {@const group = agentGroups[activeGroupIndex]}
                <div class="agent-card-wrapper">
                    <div class="agent-block {group.status} active-focus">
                        <div class="block-header">
                            <span class="agent-icon">
                                {#if group.agent.includes("Gatekeeper")}🚪
                                {:else if group.agent.includes("Extractor")}📄
                                {:else if group.agent.includes("Normalizer")}🔄
                                {:else if group.agent.includes("Validator")}✅
                                {:else if group.agent.includes("Analyst")}📊
                                {:else}🤖{/if}
                            </span>
                            <span class="agent-name">
                                {agentDisplayNames[group.agent] || group.agent}
                            </span>
                            {#if group.status === "running"}
                                <span class="status-badge running">Running</span
                                >
                            {:else if group.status === "completed"}
                                <span class="status-badge success">Done</span>
                            {:else if group.status === "error"}
                                <span class="status-badge error">Error</span>
                            {/if}
                        </div>

                        <div class="block-body">
                            {#if group.logs.length === 0}
                                <div class="no-logs">
                                    작업을 기다리고 있습니다...
                                </div>
                            {/if}
                            {#each group.logs as log}
                                <div class="log-line {log.level.toLowerCase()}">
                                    <span class="log-time"
                                        >{getTime(log.timestamp)}</span
                                    >
                                    <span class="log-level-icon"
                                        >{getIcon(log.level)}</span
                                    >
                                    <span class="log-text">
                                        {#if log.action}<strong
                                                >{log.action}</strong
                                            >:
                                        {/if}
                                        {log.detail}
                                    </span>
                                </div>
                            {/each}
                        </div>
                    </div>
                </div>
            {/if}

            {#if agentGroups.length === 0}
                <div class="empty-pipeline">
                    <div class="ghost-card">대기 중...</div>
                </div>
            {/if}
        </div>
    </div>

    <!-- Navigation Controls - Always Visible -->
    <div class="nav-controls">
        <button
            class="nav-btn prev"
            onclick={prev}
            disabled={activeGroupIndex === 0}
            aria-label="Previous agent"
        >
            <span class="nav-icon">←</span>
            <span class="btn-label">이전</span>
        </button>

        <div class="nav-center">
            <div class="agent-compact-info">
                <span class="agent-count"
                    >{activeGroupIndex + 1} / {agentGroups.length || 0}</span
                >
                <span class="agent-name-label">
                    {#if agentGroups[activeGroupIndex]}
                        {agentGroups[activeGroupIndex].agent.split("_").pop() ||
                            agentGroups[activeGroupIndex].agent}
                    {:else}
                        No agents
                    {/if}
                </span>
            </div>
            <div
                class="indicators"
                role="navigation"
                aria-label="Agent navigation"
            >
                {#each agentGroups as group, i}
                    <button
                        class="dot {i === activeGroupIndex
                            ? 'active'
                            : ''} {group.status}"
                        onclick={() => scrollToGroup(i)}
                        aria-label="Go to {agentDisplayNames[group.agent] ||
                            group.agent}"
                        aria-current={i === activeGroupIndex}
                        tabindex="0"
                    >
                    </button>
                {/each}
            </div>
        </div>

        <button
            class="nav-btn next"
            onclick={next}
            disabled={activeGroupIndex >= agentGroups.length - 1}
            aria-label="Next agent"
        >
            <span class="btn-label">이후</span>
            <span class="nav-icon">→</span>
        </button>
    </div>
</div>

<style>
    .pipeline-wrapper {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        background: #181825;
        border-radius: 12px;
        border: 1px solid #2d2d3f;
        overflow: hidden;
    }

    .pipeline-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        overflow: hidden;
    }

    .pipeline-track {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        max-width: 600px;
        margin: 0 auto;
    }

    .agent-card-wrapper {
        width: 100%;
        display: flex;
        justify-content: center;
    }

    .agent-block {
        width: 100%;
        max-width: 500px;
        /* Height adjustment for single-screen feel - Make it responsive but not too tall */
        min-height: 320px;
        max-height: 450px; /* Cap height to ensure it fits on mobile screens */
        background: var(--fluent-bg-layer);
        border-radius: 16px;
        border: 1px solid var(--fluent-border-default);
        display: flex;
        flex-direction: column;
        box-shadow: var(--fluent-shadow-8);
        transition: all 0.3s ease;
    }

    .agent-block.active-focus {
        /* Gradient Border Logic */
        border: 1px solid var(--fluent-accent);
        background-color: var(--fluent-bg-layer);

        /* Strong Glow Effect - Dark Mode Blue */
        box-shadow:
            0 0 20px rgba(59, 130, 246, 0.25),
            /* Blue glow */ 0 0 0 1px rgba(59, 130, 246, 0.4); /* Sharp thin border */

        animation: breath-glow 3s infinite ease-in-out;
    }

    @keyframes breath-glow {
        0% {
            box-shadow:
                0 0 15px rgba(59, 130, 246, 0.2),
                0 0 0 1px rgba(59, 130, 246, 0.4);
        }
        50% {
            box-shadow:
                0 0 30px rgba(59, 130, 246, 0.5),
                0 0 0 2px rgba(59, 130, 246, 0.6);
        }
        100% {
            box-shadow:
                0 0 15px rgba(59, 130, 246, 0.2),
                0 0 0 1px rgba(59, 130, 246, 0.4);
        }
    }

    .agent-block.error {
        border-color: #f38ba8;
    }

    .block-header {
        padding: 1.25rem;
        background: rgba(0, 0, 0, 0.2);
        border-bottom: 1px solid var(--fluent-border-default);
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .agent-icon {
        font-size: 1.5rem;
    }

    .agent-name {
        font-weight: 700;
        color: var(--fluent-text-primary);
        font-size: 1rem;
        flex: 1;
    }

    .status-badge {
        font-size: 0.7rem;
        padding: 2px 8px;
        border-radius: 12px;
        font-weight: 600;
        text-transform: uppercase;
    }
    .status-badge.running {
        background: #89b4fa;
        color: #1e1e2e;
    }
    .status-badge.success {
        background: #a6e3a1;
        color: #1e1e2e;
    }
    .status-badge.error {
        background: #f38ba8;
        color: #1e1e2e;
    }

    .block-body {
        flex: 1;
        padding: 1rem;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .log-line {
        font-size: 0.8rem;
        color: var(--fluent-text-primary);
        padding: 8px 10px;
        background: rgba(0, 0, 0, 0.02);
        border-radius: 6px;
        border-left: 2px solid transparent;
        display: flex;
        gap: 8px;
        line-height: 1.4;
    }

    .log-time {
        font-family: monospace;
        font-size: 0.75rem;
        color: var(--fluent-text-tertiary);
        white-space: nowrap;
    }

    .log-level-icon {
        flex-shrink: 0;
    }

    .log-text {
        word-break: break-all;
    }

    .no-logs {
        padding: 2rem;
        text-align: center;
        color: #585b70;
        font-style: italic;
    }

    .log-line.info {
        border-left-color: #89b4fa;
    }
    .log-line.success {
        border-left-color: #a6e3a1;
        background: rgba(166, 227, 161, 0.08);
    }
    .log-line.error {
        border-left-color: #f38ba8;
        background: rgba(243, 139, 168, 0.08);
        color: #f38ba8;
    }
    .log-line.warning {
        border-left-color: #f9e2af;
        background: rgba(249, 226, 175, 0.05);
    }

    .connector {
        width: 60px;
        display: flex;
        justify-content: center;
        color: #585b70;
        opacity: 0.5;
    }

    /* Navigation Controls */
    .nav-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: rgba(0, 0, 0, 0.2);
        border-top: 1px solid var(--fluent-border-default);
        flex-shrink: 0;
        border-bottom-left-radius: 16px;
        border-bottom-right-radius: 16px;
    }

    .nav-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        background: var(--fluent-bg-layer);
        border: 1px solid var(--fluent-border-default);
        border-radius: 8px;
        color: var(--fluent-text-secondary);
        padding: 0.5rem 0.75rem;
        cursor: pointer;
        transition: all 0.2s;
        font-weight: 600;
        font-size: 0.9rem;
        box-shadow: var(--fluent-shadow-2);
    }

    .nav-btn:hover:not(:disabled) {
        background: var(--fluent-bg-card);
        border-color: var(--fluent-accent);
        color: var(--fluent-accent-light);
        box-shadow: var(--btn-3d-shadow);
        transform: translateY(-1px);
    }

    .nav-btn:active:not(:disabled) {
        transform: translateY(1px);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .nav-btn:disabled {
        opacity: 0.2;
        cursor: not-allowed;
    }

    .nav-center {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
    }

    .agent-compact-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
    }

    .agent-count {
        color: var(--fluent-accent-light);
        font-family: monospace;
        font-weight: bold;
    }

    .agent-name-label {
        color: var(--fluent-text-primary);
        font-weight: 500;
        max-width: 100px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .indicators {
        display: flex;
        gap: 6px;
        align-items: center;
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 4px;
        background: var(--fluent-border-strong);
        border: none;
        cursor: pointer;
        transition: all 0.3s;
        padding: 0;
    }

    .dot.active {
        background: #89b4fa;
        width: 16px;
        box-shadow: 0 0 8px rgba(137, 180, 250, 0.4);
    }

    .dot.running {
        background: #89b4fa;
        animation: pulse-dot 1s infinite alternate;
    }

    .dot.completed {
        background: #a6e3a1;
    }

    .dot.error {
        background: #f38ba8;
    }

    @keyframes pulse-dot {
        from {
            opacity: 0.5;
            transform: scale(0.9);
        }
        to {
            opacity: 1;
            transform: scale(1.1);
        }
    }

    .btn-label {
        font-size: 0.8rem;
    }

    @media (max-width: 400px) {
        .btn-label {
            display: none;
        }
        .nav-btn {
            padding: 0.5rem;
        }
    }

    /* Progress Bar */
    .progress-bar {
        height: 3px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 2px;
        overflow: hidden;
        margin: 0 1rem 0.5rem;
        flex-shrink: 0;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, #89b4fa, #b4befe);
        transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 0 8px rgba(137, 180, 250, 0.4);
    }

    /* Navigation Icon */
    .nav-icon {
        display: inline-block;
        transition: transform 0.2s ease;
    }

    .nav-btn:hover:not(:disabled) .nav-icon {
        transform: scale(1.2);
    }

    .nav-btn:active:not(:disabled) .nav-icon {
        transform: scale(0.9);
    }

    /* Scrollbar for log body */
    .block-body::-webkit-scrollbar {
        width: 4px;
    }
    .block-body::-webkit-scrollbar-thumb {
        background: #45475a;
        border-radius: 2px;
    }

    .empty-pipeline {
        width: 320px;
        height: 420px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .ghost-card {
        color: #585b70;
        border: 2px dashed #313244;
        padding: 2rem;
        border-radius: 16px;
    }
</style>
