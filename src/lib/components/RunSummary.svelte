<script lang="ts">
    import type { InsightsAnswerSet, RunStatus } from "$lib/types";

    export let status: RunStatus | "loading";
    export let finalAnswer: InsightsAnswerSet | null = null;
    export let connectedModel: string | null = null;
    export let hitlId: string | undefined = undefined;

    // Status Badge Logic
    const getStatusInfo = (s: RunStatus | "loading") => {
        switch (s) {
            case "loading":
                return {
                    label: "로딩 중",
                    color: "bg-gray-500",
                    icon: "⏳",
                    animate: true,
                };
            case "running":
                return {
                    label: "분석 진행 중",
                    color: "bg-blue-500",
                    icon: "⚙️",
                    animate: true,
                };
            case "completed":
                return {
                    label: "분석 완료",
                    color: "bg-emerald-500",
                    icon: "✅",
                    animate: false,
                };
            case "hitl":
                return {
                    label: "확인 필요",
                    color: "bg-amber-500",
                    icon: "⚠️",
                    animate: true,
                };
            case "error":
                return {
                    label: "오류 발생",
                    color: "bg-red-500",
                    icon: "❌",
                    animate: false,
                };
            case "rejected":
                return {
                    label: "거부됨",
                    color: "bg-red-500",
                    icon: "🚫",
                    animate: false,
                };
            default:
                return {
                    label: "대기 중",
                    color: "bg-gray-500",
                    icon: "zzz",
                    animate: false,
                };
        }
    };

    $: statusInfo = getStatusInfo(status);

    $: totalShareholders = (() => {
        const summaryCount =
            finalAnswer?.validation_summary?.summary_metrics?.total_records;
        if (summaryCount != null && summaryCount > 0) {
            return summaryCount;
        }
        if (
            finalAnswer?.over_25_percent &&
            !("UNKNOWN" in finalAnswer.over_25_percent)
        ) {
            return finalAnswer.over_25_percent.length;
        }
        return 0;
    })();

    // Calculate Beneficial Owners Count
    $: beneficialOwnerCount = (() => {
        if (
            finalAnswer?.over_25_percent &&
            !("UNKNOWN" in finalAnswer.over_25_percent)
        ) {
            return finalAnswer.over_25_percent.length;
        }
        return 0;
    })();

    // Check if Top Shareholder Fallback occurred
    $: isFallbackBO = (() => {
        if (
            !finalAnswer?.over_25_percent ||
            "UNKNOWN" in finalAnswer.over_25_percent
        ) {
            return false;
        }
        return (
            finalAnswer.over_25_percent.length > 0 &&
            finalAnswer.over_25_percent.every((h) => (h.ratio || 0) < 25)
        );
    })();

    // Force stop handler
    async function handleForceStop() {
        if (!confirm("정말로 분석을 중단하시겠습니까?")) return;

        try {
            const runId = window.location.pathname.split("/").pop();
            const response = await fetch(`/api/runs/${runId}/cancel`, {
                method: "POST",
            });

            if (response.ok) {
                window.location.reload();
            } else {
                alert("중단 요청에 실패했습니다.");
            }
        } catch (error) {
            console.error("Force stop error:", error);
            alert("오류가 발생했습니다.");
        }
    }

    // Format entity type for display
    function formatEntityType(entity_type: string): string {
        switch (entity_type) {
            case "INDIVIDUAL":
                return "개인";
            case "CORPORATE":
                return "법인";
            default:
                return "불명";
        }
    }

    // Format identifier for display
    function formatIdentifier(
        identifier: string | null,
        identifier_type: string | null | undefined,
        entity_type: string,
    ): string {
        if (!identifier) return "-";

        // For individuals - show as birthdate if possible
        if (entity_type === "INDIVIDUAL") {
            // Check if it looks like RRN or YYMMDD
            if (identifier.length >= 6) {
                // Simple heuristic: if it contains dash, return as is (already normalized)
                if (identifier.includes("-") && identifier.length === 10)
                    return identifier; // YYYY-MM-DD

                // If raw RRN (usually filtered by normalization but just in case)
                if (identifier.includes("-") && identifier.length > 10) {
                    return identifier.split("-")[0]; // Return front part
                }
            }
        }
        return identifier;
    }
</script>

<div class="run-summary">
    <!-- Card 1: Status & Header -->
    <div class="info-card">
        <div class="status-header">
            <div class="left-badges">
                <div
                    class="status-badge {statusInfo.color} {statusInfo.animate
                        ? 'pulse'
                        : ''}"
                >
                    <span class="icon">{statusInfo.icon}</span>
                    <span class="label">{statusInfo.label}</span>
                </div>

                {#if status === "completed" && finalAnswer?.validation_summary?.decidability}
                    {#if finalAnswer.validation_summary.decidability.is_decidable}
                        <div class="result-badge pass">
                            <span class="icon">✨</span>
                            AI 심사 통과
                        </div>
                    {:else}
                        <div class="result-badge review">
                            <span class="icon">👀</span>
                            사람 확인 필요
                        </div>
                    {/if}
                {/if}
            </div>

            {#if connectedModel}
                <div class="model-badge">
                    <span class="dot"></span>
                    {connectedModel}
                </div>
            {/if}
        </div>

        <!-- Running/Error States content inside the first card -->
        {#if status === "running" || status === "loading"}
            <div class="running-box">
                <div class="spinner"></div>
                <p>AI가 주주명부를 분석하고 있습니다...</p>
                <button class="stop-btn" on:click={handleForceStop}>
                    <span>⏹</span> 강제 중단
                </button>
            </div>
        {:else if status === "error"}
            <div class="message-box error">
                시스템 오류가 발생했습니다. 로그를 확인해주세요.
            </div>
        {:else if status === "rejected"}
            <div class="message-box error">
                주주명부가 아니거나 분석할 수 없는 문서입니다.
            </div>
        {:else if status === "hitl"}
            <div class="message-box warning">
                사람의 확인이 필요한 항목이 있습니다.
                {#if hitlId}
                    <a href="/hitl/{hitlId}" class="hitl-btn-link">
                        확인하기 →
                    </a>
                {/if}
            </div>
        {/if}
    </div>

    <!-- Results Cards (Only when completed) -->
    {#if status === "completed" && finalAnswer}
        <!-- Analysis Context (Summary) -->
        <div class="info-card context-card">
            <div class="context-grid">
                <div class="context-item">
                    <span class="label">분석 대상 회사</span>
                    <span class="value highlight">
                        {finalAnswer.company_name || "미확인"}
                    </span>
                </div>
                <div class="context-item">
                    <span class="label">문서 발행일 (기준일)</span>
                    <span
                        class="value {finalAnswer.document_date_staleness
                            ?.is_stale
                            ? 'stale-warning'
                            : ''}"
                    >
                        {finalAnswer.document_date || "미기재"}
                        {#if finalAnswer.document_date_staleness?.is_stale}
                            <span
                                class="stale-badge"
                                title="{finalAnswer.document_date_staleness
                                    .days_diff}일 경과됨 (기준: 365일)"
                            >
                                ⚠️ 1년 초과
                            </span>
                        {/if}
                    </span>
                </div>
            </div>
        </div>

        <!-- Card 2: Analysis Reasoning -->
        {#if finalAnswer.synthesis_reasoning}
            <div class="info-card">
                <h3 class="card-title">종합 분석 소견</h3>
                <div class="reasoning-text">
                    {finalAnswer.synthesis_reasoning}
                </div>
            </div>
        {/if}

        <!-- Card 3: 25% Shareholders/Beneficial Owners -->
        <div class="info-card">
            <div class="card-header-row">
                <h3 class="card-title">
                    {isFallbackBO ? "최대주주 (25% 미만)" : "25% 이상 실소유자"}
                </h3>
                <span class="card-subtitle"
                    >총 {beneficialOwnerCount}명 식별됨</span
                >
            </div>

            {#if finalAnswer.over_25_percent && !("UNKNOWN" in finalAnswer.over_25_percent)}
                <div class="shareholders-list">
                    {#each finalAnswer.over_25_percent as shareholder, i}
                        <div class="shareholder-item">
                            <span class="rank">{i + 1}.</span>
                            <div class="shareholder-info">
                                <span class="name highlight">
                                    {(shareholder.name || "이름 미상")
                                        .replace("(확인 필요)", "")
                                        .trim()}
                                    {#if (shareholder.name || "").includes("(확인 필요)")}
                                        <span
                                            class="check-needed-badge"
                                            title="성명 오타 교정이 발생했습니다"
                                            >확인 필요</span
                                        >
                                    {/if}
                                </span>
                                <span class="entity-meta">
                                    {formatEntityType(shareholder.entity_type)}
                                    ·
                                    {formatIdentifier(
                                        shareholder.identifier,
                                        shareholder.identifier_type,
                                        shareholder.entity_type,
                                    )}
                                </span>
                            </div>
                            <span class="ratio"
                                >{shareholder.ratio?.toFixed(2)}%</span
                            >
                        </div>
                    {/each}
                    {#if finalAnswer.over_25_percent.length === 0}
                        <div class="empty-message">
                            25% 이상 실소유자가 없습니다.
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="message-box warning">
                    ⚠️ {finalAnswer.over_25_percent &&
                    "UNKNOWN" in finalAnswer.over_25_percent
                        ? finalAnswer.over_25_percent.reason
                        : "식별 불가"}
                </div>
            {/if}
        </div>

        <!-- Back to Home Action -->
        <div class="actions-footer">
            <a href="/" class="home-btn">
                <span>🏠</span> 홈으로 가기
            </a>
        </div>
    {/if}
</div>

<style>
    .run-summary {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        width: 100%;
    }

    .info-card {
        background: #1e1e2e;
        border-radius: 12px;
        padding: 1.25rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        border: 1px solid #3d3d5c;
        width: 100%;
        box-sizing: border-box; /* IMPORTANT */
    }

    .context-card {
        background: linear-gradient(135deg, #1e1e2e, #161625);
        border-color: #4c51bf; /* Indigo accent */
    }

    .context-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
    }

    .context-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .context-item .label {
        font-size: 0.75rem;
        color: #718096;
        text-transform: uppercase;
        letter-spacing: 0.025em;
    }

    .context-item .value {
        font-size: 1.1rem;
        font-weight: 600;
        color: #e2e8f0;
    }

    .context-item .value.highlight {
        color: #6366f1; /* Indigo light */
    }

    .context-item .value.stale-warning {
        color: #ef4444; /* Error red */
    }

    .stale-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        background: rgba(239, 68, 68, 0.2);
        color: #fca5a5;
        font-size: 0.7rem;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 8px;
        vertical-align: middle;
        font-weight: 600;
        border: 1px solid rgba(239, 68, 68, 0.3);
        cursor: help;
    }

    .card-title {
        font-size: 1.1rem;
        font-weight: 700;
        color: #cbd5e0; /* Lighter gray */
        margin: 0 0 1rem 0;
        display: block;
    }

    /* Enhanced visibility for Beneficial Owner section specifically */
    .card-header-row .card-title {
        font-size: 1.3rem;
        color: #818cf8; /* Vibrant indigo */
        letter-spacing: -0.01em;
    }

    .card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 1rem;
        border-bottom: 1px solid #3d3d5c;
        padding-bottom: 0.5rem;
    }

    .card-header-row .card-title {
        margin: 0;
    }

    .card-subtitle {
        font-size: 1.1rem;
        font-weight: 600;
        color: #9ca3af; /* More visible light gray */
    }

    .status-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0; /* No margin if empty below, but handled by gap if content exists */
    }

    /* If status is running/error, we need margin below header */
    .status-header:not(:last-child) {
        margin-bottom: 1.25rem;
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 20px;
        color: white;
        font-weight: 600;
        font-size: 0.9rem;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .pulse {
        animation: pulse 2s infinite;
    }
    @keyframes pulse {
        0% {
            box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4);
        }
        70% {
            box-shadow: 0 0 0 6px rgba(255, 255, 255, 0);
        }
        100% {
            box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
        }
    }

    /* Colors */
    .bg-gray-500 {
        background-color: #6b7280;
    }
    .bg-blue-500 {
        background-color: #3b82f6;
    }
    .bg-emerald-500 {
        background-color: #10b981;
    }
    .bg-amber-500 {
        background-color: #f59e0b;
    }
    .bg-red-500 {
        background-color: #ef4444;
    }

    .model-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8rem;
        color: #a0aec0;
        background: rgba(255, 255, 255, 0.05);
        padding: 4px 8px;
        border-radius: 6px;
    }

    .dot {
        width: 6px;
        height: 6px;
        background-color: #10b981;
        border-radius: 50%;
    }

    .left-badges {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .result-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 0.9rem;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    .result-badge.pass {
        background-color: #10b981;
        color: white;
    }
    .result-badge.review {
        background-color: #f59e0b;
        color: white;
    }

    /* Reasoning Text */
    .reasoning-text {
        color: #e2e8f0;
        line-height: 1.6;
        font-size: 0.95rem;
        white-space: pre-wrap;
    }

    /* Shareholders List */
    .shareholders-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .shareholder-item {
        display: grid;
        grid-template-columns: 30px 1fr auto; /* Rank | Info | Ratio */
        gap: 1rem;
        padding: 0.75rem 1rem;
        background: rgba(255, 255, 255, 0.02);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        align-items: center;
    }

    .shareholder-item .rank {
        font-weight: 600;
        color: #94a3b8;
        text-align: center;
    }

    .shareholder-info {
        display: flex;
        flex-direction: row;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
    }

    .shareholder-item .name {
        font-weight: 600;
        color: #e2e8f0;
        font-size: 1.05rem;
        white-space: nowrap;
    }

    .entity-meta {
        font-size: 1.1rem;
        color: #cbd5e0; /* Lighter gray for better visibility */
        font-family: monospace;
        display: inline-flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.05);
        padding: 2px 8px;
        border-radius: 4px;
        margin-left: 0.5rem;
    }

    .shareholder-item .ratio {
        font-size: 1.1rem;
        font-weight: 700;
        color: #48bb78;
        text-align: right;
    }

    .empty-message {
        text-align: center;
        color: #718096;
        padding: 1rem;
    }

    .check-needed-badge {
        background: rgba(239, 68, 68, 0.2);
        color: #fca5a5;
        font-size: 0.75rem;
        padding: 2px 6px;
        border-radius: 4px;
        margin-left: 6px;
        vertical-align: middle;
        font-weight: 500;
        border: 1px solid rgba(239, 68, 68, 0.3);
        cursor: help;
    }

    /* Running/Error Box */
    .running-box {
        text-align: center;
        color: #a0aec0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: center;
        padding-top: 1rem;
    }

    .spinner {
        width: 30px;
        height: 30px;
        border: 3px solid rgba(255, 255, 255, 0.1);
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }

    .stop-btn {
        padding: 0.6rem 1.2rem;
        background: #ef4444;
        color: white;
        border: none;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .stop-btn:hover {
        background: #dc2626;
    }

    .message-box {
        padding: 1rem;
        border-radius: 8px;
        text-align: center;
        width: 100%;
        box-sizing: border-box;
    }
    .message-box.error {
        background: rgba(239, 68, 68, 0.1);
        color: #fca5a5;
        border: 1px solid rgba(239, 68, 68, 0.2);
    }
    .message-box.warning {
        background: rgba(245, 158, 11, 0.1);
        color: #fcd34d;
        border: 1px solid rgba(245, 158, 11, 0.2);
    }

    .hitl-btn-link {
        display: inline-block;
        margin-left: 0.5rem;
        color: #fcd34d;
        text-decoration: underline;
        font-weight: 700;
    }
    .hitl-btn-link:hover {
        background: rgba(245, 158, 11, 0.3);
    }

    /* Actions Footer & Home Button */
    .actions-footer {
        display: flex;
        justify-content: center;
        padding: 1rem 0;
        margin-top: 0.5rem;
    }

    .home-btn {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 2.5rem;
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        color: white;
        text-decoration: none;
        border-radius: 12px;
        font-weight: 700;
        font-size: 1.1rem;
        box-shadow: 0 4px 15px rgba(99, 102, 241, 0.3);
        transition: all 0.2s ease;
    }

    .home-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
        filter: brightness(1.1);
    }

    .home-btn:active {
        transform: translateY(0);
    }
</style>
