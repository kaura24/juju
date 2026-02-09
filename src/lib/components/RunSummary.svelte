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

    // Stats Logic
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

    let isFallbackBO = $derived(
        (() => {
            if (!Array.isArray(finalAnswer?.over_25_percent)) return false;
            return (
                finalAnswer.over_25_percent.length > 0 &&
                finalAnswer.over_25_percent.every((h) => (h.ratio || 0) < 25)
            );
        })(),
    );

    let hasBlocker = $derived(
        (() => {
            const triggers = finalAnswer?.validation_summary?.triggers || [];
            return triggers.some((t) => t.severity === "BLOCKER");
        })(),
    );

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

    function formatIdentifier(
        id: string | null,
        type: string | null | undefined,
        entity: string,
    ): string {
        if (!id) return "-";
        if (entity === "INDIVIDUAL") {
            if (id.includes("-") && id.length === 10) return id; // YYYY-MM-DD
            if (id.includes("-") && id.length > 10) return id.split("-")[0];
        }
        return id;
    }

    async function handleForceStop() {
        if (!confirm("정말로 분석을 중단하시겠습니까?")) return;
        try {
            const runId = window.location.pathname.split("/").pop();
            await fetch(`/api/runs/${runId}/cancel`, { method: "POST" });
            window.location.reload();
        } catch (error) {
            alert("오류가 발생했습니다.");
        }
    }
</script>

<div class="run-summary">
    <!-- Card 1: Status & Header (Slide Up 1) -->
    <div class="info-card">
        <div class="status-header">
            <div class="left-badges">
                <!-- Status Badge -->
                {#if (status === "loading" || status === "running") && !finalAnswer}
                    <div class="status-badge bg-blue-500 pulse">
                        <span class="icon">⚙️</span>
                        <span class="label">분석 진행 중</span>
                    </div>
                {:else if status === "completed"}
                    <div class="status-badge bg-emerald-500">
                        <span class="icon">✅</span>
                        <span class="label">분석 완료</span>
                    </div>
                {:else if status === "error"}
                    <div class="status-badge bg-red-500">
                        <span class="icon">❌</span>
                        <span class="label">오류 발생</span>
                    </div>
                {/if}

                {#if storageProvider === "SUPABASE"}
                    <div class="status-badge bg-green-500">
                        <span class="icon">🟢</span>
                        <span class="label">Supabase Storage</span>
                    </div>
                {/if}

                <!-- Pass/Fail Badge -->
                {#if status === "completed" && finalAnswer?.validation_summary?.decidability}
                    {#if finalAnswer.validation_summary.decidability.is_decidable}
                        <div class="result-badge pass">
                            <span class="icon">✨</span> AI 심사 통과
                        </div>
                    {:else}
                        <div class="result-badge review">
                            <span class="icon">👀</span> 사람 확인 필요
                        </div>
                    {/if}
                {/if}
                {#if hasBlocker}
                    <div class="result-badge review">
                        <span class="icon">👀</span> 인간 검토 필요
                    </div>
                {/if}
            </div>
        </div>

        <!-- Waiting State -->
        {#if (status === "running" || status === "loading") && !finalAnswer}
            <div class="running-box">
                <div class="dot-pulse">
                    <div class="dot"></div>
                    <div class="dot"></div>
                    <div class="dot"></div>
                </div>
                <p>AI가 주주명부를 분석하고 있습니다...</p>
                <button class="stop-btn" onclick={handleForceStop}
                    >강제 중단</button
                >
            </div>
        {:else if status === "rejected"}
            <div class="message-box error">
                주주명부가 아니거나 분석할 수 없는 문서입니다.
            </div>
        {/if}

        <!-- AI Model & Storage Info Badge -->
        <div class="meta-info-row">
            {#if connectedModel}
                <div class="model-tag">
                    <span class="icon">🤖</span>
                    <span>{connectedModel}</span>
                </div>
            {/if}
            {#if storageProvider === "SUPABASE"}
                <div class="model-tag supabase-tag">
                    <span class="icon">🟢</span>
                    <span>Supabase Storage</span>
                </div>
            {/if}
        </div>

        {#if finalAnswer?.validation_summary?.summary_metrics}
            <div class="metrics-box">
                <div class="metrics-grid">
                    <div class="metric-item">
                        <div class="m-label">총 주주 수</div>
                        <div class="m-value">
                            {finalAnswer.validation_summary.summary_metrics
                                .total_records}명
                        </div>
                    </div>
                    <div class="metric-item">
                        <div class="m-label">지분율 합계</div>
                        <div
                            class="m-value {Math.abs(
                                (finalAnswer.validation_summary.summary_metrics
                                    .sum_ratio || 0) - 100,
                            ) > 0.01
                                ? 'text-red'
                                : 'text-green'}"
                        >
                            {(
                                finalAnswer.validation_summary.summary_metrics
                                    .sum_ratio || 0
                            ).toFixed(2)}%
                        </div>
                    </div>
                    <div class="metric-item">
                        <div class="m-label">주식수 합계</div>
                        <div class="m-value">
                            {(
                                finalAnswer.validation_summary.summary_metrics
                                    .sum_shares || 0
                            ).toLocaleString()}주
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        {#if finalAnswer?.validation_summary?.triggers && finalAnswer.validation_summary.triggers.length > 0}
            <div class="triggers-box">
                <div class="triggers-header">
                    데이터 정합성 검증 ({finalAnswer.validation_summary.triggers
                        .length})
                </div>
                <div class="triggers-list">
                    {#each finalAnswer.validation_summary.triggers as trigger}
                        <div
                            class="trigger-item {trigger.severity.toLowerCase()}"
                        >
                            <span class="t-icon">
                                {#if trigger.severity === "BLOCKER"}🚫{:else if trigger.severity === "WARNING"}⚠️{:else}ℹ️{/if}
                            </span>
                            <div class="t-content">
                                <div class="t-message">{trigger.message}</div>
                                {#if trigger.suggestion}
                                    <div class="t-suggestion">
                                        💡 {trigger.suggestion}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    {/each}
                </div>
            </div>
        {/if}

        <!-- Step 5 Reasoning -->
        {#if finalAnswer?.synthesis_reasoning}
            <div class="analyst-inline-box">
                <div class="analyst-header">
                    <span class="icon">💡</span>
                    <span class="label">AI 분석 소견</span>
                </div>
                <div class="reasoning-text-compact">
                    {finalAnswer.synthesis_reasoning}
                </div>
            </div>
        {/if}
    </div>

    <!-- Results Cards (Only when completed) -->
    {#if (status === "completed" || status === "hitl") && finalAnswer}
        <!-- Analysis Context (Summary) -->
        <div class="info-card context-card">
            <div class="context-grid">
                <div class="context-item">
                    <span class="label">분석 대상 회사</span>
                    <span class="value highlight"
                        >{finalAnswer.company_name || "미확인"}</span
                    >
                </div>
                <div class="context-item">
                    <span class="label">문서 기준일</span>
                    <span
                        class="value {finalAnswer.document_date_staleness
                            ?.is_stale
                            ? 'stale-warning'
                            : ''}"
                    >
                        {finalAnswer.document_date || "미기재"}
                        {#if finalAnswer.document_date_staleness?.is_stale}
                            <span class="stale-badge">⚠️ 1년 초과</span>
                        {/if}
                    </span>
                </div>
            </div>
        </div>

        <!-- Shareholders List -->
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
                                        <span class="check-needed-badge"
                                            >확인 필요</span
                                        >
                                    {/if}
                                </span>
                                <span class="entity-meta">
                                    {formatEntityType(shareholder.entity_type)} ·
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
            {/if}
        </div>
    {/if}

    <!-- Footer Actions -->
    {#if status !== "running" && status !== "loading"}
        <div class="actions-footer">
            <a href="/" class="home-btn"><span>🏠</span> 홈으로 가기</a>
        </div>
    {/if}
</div>

<style>
    /* Clean, Modern Styles */
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
        opacity: 1;
    }

    /* Badges */
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

    .bg-blue-500 {
        background-color: #3b82f6;
    }
    .bg-emerald-500 {
        background-color: #10b981;
    }
    .bg-red-500 {
        background-color: #ef4444;
    }
    .pass {
        background-color: #10b981;
        color: white;
    }
    .review {
        background-color: #f59e0b;
        color: white;
    }
    .bg-green-500 {
        background-color: #10b981;
        /* Same as emerald-500 */
    }

    /* Dot Pulse Animation */
    .dot-pulse {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-bottom: 1rem;
    }
    .dot {
        width: 10px;
        height: 10px;
        background-color: #3b82f6;
        border-radius: 50%;
        animation: dotPulse 1.4s infinite ease-in-out both;
    }
    .dot:nth-child(1) {
        animation-delay: -0.32s;
    }
    .dot:nth-child(2) {
        animation-delay: -0.16s;
    }

    @keyframes dotPulse {
        0%,
        80%,
        100% {
            transform: scale(0);
        }
        40% {
            transform: scale(1);
        }
    }

    .running-box {
        text-align: center;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 2rem 0;
        color: #64748b;
    }
    .supabase-tag {
        background-color: #ecfdf5;
        border-color: #a7f3d0;
        color: #059669;
    }

    .model-tag {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        border: 1px solid #e2e8f0;
        padding: 4px 10px;
        border-radius: 14px;
        font-size: 0.8rem;
        color: #64748b;
        background: #f8fafc;
        font-weight: 500;
    }

    /* Restored Metrics and Triggers Styles */
    .meta-info-row {
        display: flex;
        gap: 8px;
        margin: 1rem 0;
        flex-wrap: wrap;
    }

    .metrics-box {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 1rem;
    }
    .metrics-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1rem;
        text-align: center;
    }
    .m-label {
        font-size: 0.75rem;
        color: #64748b;
        margin-bottom: 0.25rem;
        font-weight: 600;
    }
    .m-value {
        font-size: 1.1rem;
        font-weight: 700;
        color: #0f172a;
    }
    .text-red {
        color: #ef4444;
    }
    .text-green {
        color: #10b981;
    }

    .triggers-box {
        margin-bottom: 1rem;
    }
    .triggers-header {
        font-size: 0.85rem;
        font-weight: 700;
        color: #475569;
        margin-bottom: 0.5rem;
        padding-left: 0.25rem;
    }
    .triggers-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .trigger-item {
        display: flex;
        gap: 0.75rem;
        padding: 0.75rem;
        border-radius: 6px;
        font-size: 0.9rem;
        border: 1px solid transparent;
    }
    .trigger-item.blocker {
        background: #fef2f2;
        border-color: #fee2e2;
        color: #b91c1c;
    }
    .trigger-item.warning {
        background: #fffbeb;
        border-color: #fef3c7;
        color: #b45309;
    }
    .trigger-item.info {
        background: #f0f9ff;
        border-color: #e0f2fe;
        color: #0369a1;
    }
    .t-icon {
        font-size: 1.1rem;
    }
    .t-message {
        font-weight: 600;
    }
    .t-suggestion {
        margin-top: 0.25rem;
        font-size: 0.8rem;
        opacity: 0.9;
    }

    /* Shareholders List */
    .shareholders-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }
    .shareholder-item {
        display: grid;
        grid-template-columns: 30px 1fr auto;
        gap: 1rem;
        padding: 0.75rem 1rem;
        background: #f8fafc;
        border-radius: 8px;
        border: 1px solid var(--fluent-border-default);
        align-items: center;
    }
    .shareholder-item .name {
        font-weight: 600;
        color: var(--fluent-text-primary);
        font-size: 1.05rem;
        white-space: nowrap;
    }
    .shareholder-item .ratio {
        font-size: 1.1rem;
        font-weight: 700;
        color: #10b981;
        text-align: right;
    }

    .context-card {
        background: linear-gradient(135deg, #ffffff, #f8fafc);
        border-color: #e2e8f0;
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
    .context-item .value {
        font-size: 1.1rem;
        font-weight: 600;
        color: #1e293b;
    }

    .analyst-inline-box {
        margin-top: 1.25rem;
        padding: 1rem;
        background: #eff6ff;
        border: 1px solid #bfdbfe;
        border-left: 4px solid #3b82f6;
        border-radius: 8px;
    }
    .analyst-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 0.5rem;
        font-weight: 700;
        color: #1e40af;
    }
    .reasoning-text-compact {
        font-size: 0.95rem;
        line-height: 1.6;
        color: #1e3a8a;
        white-space: pre-wrap;
    }

    .card-header-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: 1rem;
        border-bottom: 1px solid #e2e8f0;
        padding-bottom: 0.5rem;
    }
    .card-title {
        font-size: 1.2rem;
        font-weight: 700;
        color: #1e293b;
        margin: 0;
    }

    .actions-footer {
        display: flex;
        justify-content: center;
        margin-top: 1rem;
    }
    .home-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 12px 24px;
        background: white;
        border: 1px solid #cbd5e1;
        border-radius: 8px;
        font-weight: 600;
        color: #475569;
        text-decoration: none;
        transition: all 0.2s;
    }
    .home-btn:hover {
        background: #f1f5f9;
        color: #0f172a;
        transform: translateY(-1px);
    }
</style>
