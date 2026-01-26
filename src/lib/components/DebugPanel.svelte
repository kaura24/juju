<script lang="ts">
    import { onMount } from "svelte";

    interface DebugLog {
        timestamp: string;
        type: "info" | "error" | "sse" | "api" | "poll";
        message: string;
        data?: any;
    }

    let { runId = "" } = $props();
    let isVisible = $state(false);
    let logs: DebugLog[] = $state([]);
    let isCollapsed = $state(true);

    // Global debug storage
    if (typeof window !== "undefined") {
        (window as any).__JUJU_DEBUG__ = {
            log: (type: DebugLog["type"], message: string, data?: any) => {
                const newLog = {
                    timestamp: new Date().toLocaleTimeString(),
                    type,
                    message,
                    data,
                };
                logs = [newLog, ...logs].slice(0, 100);
                console.log(`[Debug][${type}] ${message}`, data || "");
            },
        };
    }

    function toggleVisible() {
        isVisible = !isVisible;
    }

    function toggleCollapse() {
        isCollapsed = !isCollapsed;
    }

    function clearLogs() {
        logs = [];
    }

    onMount(() => {
        (window as any).__JUJU_DEBUG__?.log("info", "Debug Panel Initialized", {
            runId,
        });
    });
</script>

<div class="debug-trigger" onclick={toggleVisible} title="Toggle Debug Panel">
    🐞
</div>

{#if isVisible}
    <div class="debug-panel {isCollapsed ? 'collapsed' : ''}">
        <div class="debug-header">
            <div class="title">
                <strong>Debug Monitor</strong>
                <span class="run-id">#{runId.slice(0, 8)}</span>
            </div>
            <div class="actions">
                <button onclick={clearLogs}>Clear</button>
                <button onclick={toggleCollapse}
                    >{isCollapsed ? "Expand" : "Collapse"}</button
                >
                <button onclick={toggleVisible} class="close">×</button>
            </div>
        </div>

        {#if !isCollapsed}
            <div class="debug-content">
                {#each logs as log}
                    <div class="log-entry {log.type}">
                        <span class="time">[{log.timestamp}]</span>
                        <span class="type-tag">{log.type.toUpperCase()}</span>
                        <span class="message">{log.message}</span>
                        {#if log.data}
                            <pre class="data">{JSON.stringify(
                                    log.data,
                                    null,
                                    2,
                                )}</pre>
                        {/if}
                    </div>
                {/each}
                {#if logs.length === 0}
                    <div class="empty">No debug logs yet...</div>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
    .debug-trigger {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 40px;
        height: 40px;
        background: #333;
        color: white;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 1000;
        opacity: 0.3;
        transition: opacity 0.2s;
        font-size: 1.2rem;
    }
    .debug-trigger:hover {
        opacity: 1;
    }

    .debug-panel {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        background: #111;
        color: #eee;
        z-index: 1001;
        font-family: "Courier New", monospace;
        font-size: 0.8rem;
        border-top: 2px solid #444;
        display: flex;
        flex-direction: column;
        max-height: 50vh;
    }
    .debug-panel.collapsed {
        max-height: 40px;
    }

    .debug-header {
        padding: 8px 15px;
        background: #222;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid #333;
    }

    .actions {
        display: flex;
        gap: 10px;
    }

    button {
        background: #444;
        color: white;
        border: none;
        padding: 2px 8px;
        cursor: pointer;
        font-size: 0.7rem;
        border-radius: 3px;
    }
    button:hover {
        background: #555;
    }
    button.close {
        background: #c33;
    }

    .debug-content {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .log-entry {
        padding: 4px;
        border-radius: 3px;
        background: rgba(255, 255, 255, 0.05);
    }
    .log-entry.error {
        color: #f66;
        background: rgba(255, 0, 0, 0.1);
    }
    .log-entry.sse {
        color: #6bf;
    }
    .log-entry.api {
        color: #6f6;
    }
    .log-entry.poll {
        color: #fb6;
    }

    .time {
        color: #888;
        margin-right: 5px;
    }
    .type-tag {
        font-weight: bold;
        margin-right: 10px;
    }

    .data {
        margin: 5px 0 0 20px;
        font-size: 0.7rem;
        color: #aaa;
        background: #000;
        padding: 5px;
        border-radius: 3px;
        white-space: pre-wrap;
        max-height: 150px;
        overflow-y: auto;
    }

    .empty {
        text-align: center;
        color: #555;
        padding: 20px;
    }

    .run-id {
        font-size: 0.7rem;
        color: #888;
        margin-left: 10px;
    }
</style>
