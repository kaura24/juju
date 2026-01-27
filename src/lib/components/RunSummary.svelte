<script lang="ts">
    import type { InsightsAnswerSet, RunStatus } from "$lib/types";

    interface Props {
        status: RunStatus | "loading";
        finalAnswer: InsightsAnswerSet | null;
        connectedModel: string | null;
        storageProvider: "SUPABASE" | "LOCAL" | null;
        hitlId: string | undefined;
    }

    let {
        status,
        finalAnswer = null,
        connectedModel = null,
        storageProvider = null,
        hitlId = undefined,
    }: Props = $props();

    $inspect(connectedModel); // For debugging in browser console

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

    let statusInfo = $derived(getStatusInfo(status));

    let totalShareholders = $derived(
        (() => {
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
        })(),
    );

    // Calculate Beneficial Owners Count
    let beneficialOwnerCount = $derived(
        (() => {
            if (
                finalAnswer?.over_25_percent &&
                !("UNKNOWN" in finalAnswer.over_25_percent)
            ) {
                return finalAnswer.over_25_percent.length;
            }
            return 0;
        })(),
    );

    // Check if Top Shareholder Fallback occurred
    let isFallbackBO = $derived(
        (() => {
            if (!Array.isArray(finalAnswer?.over_25_percent)) {
                return false;
            }
            return (
                finalAnswer.over_25_percent.length > 0 &&
                finalAnswer.over_25_percent.every((h) => (h.ratio || 0) < 25)
            );
        })(),
    );

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

                {#if storageProvider}
                    <div class="storage-badge {storageProvider.toLowerCase()}">
                        <span class="icon"
                            >{storageProvider === "SUPABASE"
                                ? "☁️"
                                : "📁"}</span
                        >
                        <span class="label">{storageProvider}</span>
                    </div>
                {/if}
            </div>

            <!-- Removed Model Badge as per user request -->
        </div>

        <!-- Running/Error States content inside the first card -->
        {#if status === "running" || status === "loading"}
            <div class="running-box">
                <div class="spinner"></div>
                <p>AI가 주주명부를 분석하고 있습니다...</p>
                <button class="stop-btn" onclick={handleForceStop}>
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

        <!-- Step 5 Reasoning: Integrated into primary card for immediate context -->
        {#if finalAnswer?.synthesis_reasoning}
            <div class="analyst-inline-box">
                <div class="analyst-header">
                    <span class="icon">💡</span>
                    <span class="label">종합 인사이터 (Step 5) 소견</span>
                </div>
                <div class="reasoning-text-compact">
                    {finalAnswer.synthesis_reasoning}
                </div>
            </div>
        {/if}
    </div>

    <!-- Results Cards (Only when completed OR in HITL with results) -->
    {#if (status === "completed" || status === "hitl") && finalAnswer}
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

            {#if Array.isArray(finalAnswer.over_25_percent)}
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
                    typeof finalAnswer.over_25_percent === "object" &&
                    "reason" in finalAnswer.over_25_percent
                        ? (finalAnswer.over_25_percent as any).reason
                        : "식별 불가"}
                </div>
            {/if}
        </div>
    {/if}

    <!-- Back to Home Action (Visible in all final states) -->
    {#if status !== "running" && status !== "loading"}
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
        background: #ffffff;
        border-radius: 12px;
        padding: 1.25rem;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
        border: 1px solid var(--fluent-border-default);
        width: 100%;
        box-sizing: border-box;
    }

    .context-card {
        background: linear-gradient(135deg, #ffffff, #f8fafc);
        border-color: var(--fluent-accent-light);
    }

    .context-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 1.5rem;
    }

    @media (max-width: 600px) {
        .context-grid {
            grid-template-columns: 1fr;
            gap: 1rem;
        }
    }

    .context-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    .context-item .label {
        font-size: 0.75rem;
        color: var(--fluent-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.025em;
    }

    .context-item .value {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--fluent-text-primary);
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
        color: var(--fluent-text-primary);
        margin: 0 0 1rem 0;
        display: block;
    }

    /* Enhanced visibility for Beneficial Owner section specifically */
    .card-header-row .card-title {
        font-size: 1.3rem;
        color: var(--fluent-accent-dark); /* Darker blue for emphasis */
        letter-spacing: -0.01em;
    }

    .card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 1rem;
        border-bottom: 1px solid var(--fluent-border-default);
        padding-bottom: 0.5rem;
    }

    .card-header-row .card-title {
        margin: 0;
    }

    .card-subtitle {
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--fluent-text-secondary);
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
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .pulse {
        animation: pulse 2s infinite;
    }
    @keyframes pulse {
        0% {
            box-shadow: 0 0 0 0 rgba(99, 179, 237, 0.4);
        }
        70% {
            box-shadow: 0 0 0 6px rgba(99, 179, 237, 0);
        }
        100% {
            box-shadow: 0 0 0 0 rgba(99, 179, 237, 0);
        }
    }

    /* Colors - Pastel Friendly */
    .bg-gray-500 {
        background-color: #a0aec0;
    }
    .bg-blue-500 {
        background-color: #63b3ed;
    }
    .bg-emerald-500 {
        background-color: #68d391;
    }
    .bg-amber-500 {
        background-color: #f6e05e;
        color: #744210; /* Darker text for yellow contrast */
    }
    .bg-red-500 {
        background-color: #fc8181;
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

    .storage-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 0.85rem;
        font-weight: 600;
        border: 1px solid rgba(0, 0, 0, 0.1);
    }
    .storage-badge.supabase {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
        border-color: rgba(16, 185, 129, 0.2);
    }
    .storage-badge.local {
        background: rgba(160, 174, 192, 0.1);
        color: #718096;
        border-color: rgba(160, 174, 192, 0.2);
    }

    /* Reasoning Text */
    .reasoning-text {
        color: #1e293b; /* Slate 800 - High Contrast Dark */
        line-height: 1.6;
        font-size: 1.05rem;
        white-space: pre-wrap;

        /* Blue Note Style for High Visibility */
        background: #eff6ff; /* Blue 50 */
        border: 1px solid #bfdbfe; /* Blue 200 */
        border-left: 5px solid var(--fluent-accent); /* Tech Blue */

        padding: 1.25rem;
        border-radius: 6px;
        font-weight: 500;
        margin-top: 0.5rem;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
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
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid var(--fluent-border-default);
        align-items: center;
    }

    /* Analyst Inline Box Styles */
    .analyst-inline-box {
        margin-top: 1.25rem;
        padding: 1rem;
        background: #eff6ff; /* Blue 50 */
        border: 1px solid #bfdbfe; /* Blue 200 */
        border-left: 4px solid #3b82f6; /* Blue 500 */
        border-radius: 8px;
    }

    .analyst-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
    }

    .analyst-header .icon {
        font-size: 1.1rem;
    }

    .analyst-header .label {
        font-size: 0.9rem;
        font-weight: 700;
        color: #1e40af; /* Blue 800 */
    }

    .reasoning-text-compact {
        font-size: 0.95rem;
        line-height: 1.6;
        color: #1e3a8a; /* Blue 900 */
        white-space: pre-wrap;
    }

    .shareholder-item .rank {
        font-weight: 600;
        color: var(--fluent-text-tertiary);
        text-align: center;
    }

    .shareholder-info {
        display: flex;
        flex-direction: row;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        min-width: 0; /* Prevention of overflow */
    }

    @media (max-width: 480px) {
        .shareholder-info {
            flex-direction: column;
            align-items: flex-start;
            gap: 0.25rem;
        }
    }

    .shareholder-item .name {
        font-weight: 600;
        color: var(--fluent-text-primary);
        font-size: 1.05rem;
        white-space: nowrap;
    }

    .entity-meta {
        font-size: 1.1rem;
        color: var(--fluent-text-secondary);
        font-family: monospace;
        display: inline-flex;
        align-items: center;
        background: rgba(0, 0, 0, 0.04);
        padding: 2px 8px;
        border-radius: 4px;
        margin-left: 0.5rem;
    }

    .shareholder-item .ratio {
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--fluent-success);
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
        color: var(--fluent-text-secondary);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        align-items: center;
        padding-top: 1rem;
    }

    .spinner {
        width: 30px;
        height: 30px;
        border: 3px solid rgba(0, 0, 0, 0.05);
        border-top-color: var(--fluent-accent);
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
        background: var(--btn-danger-bg);
        border: 1px solid var(--btn-danger-border);
        color: white;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        box-shadow: var(--btn-3d-shadow);
        transition: all 0.2s;
    }
    .stop-btn:hover {
        box-shadow: var(--btn-3d-hover-shadow);
        filter: brightness(1.1);
        transform: translateY(-2px);
    }
    .stop-btn:active {
        transform: translateY(1px);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
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
        background: var(--btn-primary-bg);
        border: 1px solid var(--btn-primary-border);
        color: white;
        text-decoration: none;
        border-radius: 12px;
        font-weight: 700;
        font-size: 1.1rem;
        box-shadow: var(--btn-3d-shadow);
        transition: all 0.2s ease;
    }

    .home-btn:hover {
        transform: translateY(-2px);
        box-shadow: var(--btn-3d-hover-shadow);
        filter: brightness(1.1);
    }

    .home-btn:active {
        transform: translateY(1px);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
    }
</style>
