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
                            {#each group.logs as log}
                                <div class="log-line {log.level.toLowerCase()}">
                                    {#if log.level === "ERROR"}❌{/if}
                                    {#if log.level === "WARNING"}⚠️{/if}
                                    <span class="log-text"
                                        >{log.action}: {log.detail}</span
                                    >
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

    <!-- Navigation Controls -->
    <!-- Navigation Controls - Always Visible -->
    <div class="nav-controls">
        <button
            class="nav-btn"
            onclick={prev}
            disabled={activeGroupIndex === 0}
            aria-label="Previous agent"
        >
            <span>←</span>
        </button>

        <div class="indicators" role="navigation" aria-label="Agent navigation">
            {#each agentGroups as group, i}
                <button
                    class="dot {i === activeGroupIndex ? 'active' : ''}"
                    onclick={() => scrollToGroup(i)}
                    aria-label="Go to {agentDisplayNames[group.agent] ||
                        group.agent}"
                    aria-current={i === activeGroupIndex}
                    tabindex="0"
                    onkeydown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            scrollToGroup(i);
                        }
                    }}
                >
                </button>
            {/each}
        </div>

        <button
            class="nav-btn"
            onclick={next}
            disabled={activeGroupIndex >= agentGroups.length - 1}
            aria-label="Next agent"
        >
            <span>→</span>
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
        min-height: 400px;
        background: #1e1e2e;
        border-radius: 16px;
        border: 1px solid #313244;
        display: flex;
        flex-direction: column;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        transition: all 0.3s ease;
    }

    .agent-block.active-focus {
        border-color: #89b4fa;
        box-shadow:
            0 20px 50px rgba(137, 180, 250, 0.25),
            0 0 0 3px rgba(137, 180, 250, 0.1);
    }

    .agent-block.error {
        border-color: #f38ba8;
    }

    .block-header {
        padding: 1.25rem;
        background: linear-gradient(
            180deg,
            rgba(49, 50, 68, 0.5) 0%,
            rgba(49, 50, 68, 0) 100%
        );
        border-bottom: 1px solid #313244;
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .agent-name {
        font-weight: 700;
        color: #cdd6f4;
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
        font-size: 0.85rem;
        color: #a6adc8;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 6px;
        border-left: 2px solid transparent;
    }
    .log-line.info {
        border-left-color: #89b4fa;
    }
    .log-line.success {
        border-left-color: #a6e3a1;
        background: rgba(166, 227, 161, 0.05);
    }
    .log-line.error {
        border-left-color: #f38ba8;
        background: rgba(243, 139, 168, 0.05);
    }
    .log-line.warning {
        border-left-color: #f9e2af;
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
        justify-content: center;
        gap: 1.5rem;
        padding: 1.5rem;
        background: #13131f;
        border-top: 1px solid #2d2d44;
        flex-shrink: 0;
    }

    .nav-btn {
        width: 48px;
        height: 48px;
        background: #1e1e2e;
        border: 1px solid #313244;
        border-radius: 50%;
        color: #a0aec0;
        font-size: 1.2rem;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .nav-btn:hover:not(:disabled) {
        background: #2a2a3e;
        border-color: #89b4fa;
        color: #89b4fa;
        transform: scale(1.1);
    }

    .nav-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .indicators {
        display: flex;
        gap: 0.75rem;
        align-items: center;
    }

    .dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #45475a;
        border: none;
        cursor: pointer;
        transition: all 0.3s;
        padding: 0;
    }

    .dot:hover {
        background: #6c7086;
        transform: scale(1.2);
    }

    .dot.active {
        background: #89b4fa;
        width: 28px;
        border-radius: 6px;
        box-shadow: 0 0 12px rgba(137, 180, 250, 0.6);
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
