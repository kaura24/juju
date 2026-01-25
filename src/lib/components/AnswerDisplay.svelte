<script lang="ts">
  import type { InsightsAnswerSet, NormalizedShareholder } from "$lib/types";
  import { isUnknownAnswer } from "$lib/types";

  interface Props {
    answer: InsightsAnswerSet;
  }

  let { answer }: Props = $props();

  function formatNumber(num: number | null): string {
    if (num === null) return "-";
    return num.toLocaleString("ko-KR");
  }

  function formatRatio(ratio: number | null): string {
    if (ratio === null) return "-";
    return `${ratio.toFixed(2)}%`;
  }

  function getTrustLevelColor(level: string): string {
    switch (level) {
      case "HIGH":
        return "#10b981";
      case "MEDIUM":
        return "#f59e0b";
      case "LOW":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  }

  function getEntityTypeLabel(type: string): string {
    switch (type) {
      case "CORPORATE":
        return "법인";
      case "INDIVIDUAL":
        return "개인";
      case "UNKNOWN":
        return "미확인";
      default:
        return type;
    }
  }
</script>

<div class="answer-display">
  <div class="header">
    <h2>📊 분석 결과</h2>
    {#if answer.validation_summary.decidability}
      <div
        class="trust-badge"
        style="background-color: {answer.validation_summary.decidability
          .is_decidable
          ? '#10b981'
          : '#f59e0b'}"
      >
        {answer.validation_summary.decidability.is_decidable
          ? "판정 가능"
          : "판정 불가"}
      </div>
    {/if}
  </div>

  <!-- 문서 평가 -->
  <section class="section">
    <h3>📄 문서 평가</h3>
    <div class="field">
      <span class="label">유효한 주주명부:</span>
      <span
        class="value status-{answer.document_assessment.is_valid_shareholder_register.toLowerCase()}"
      >
        {answer.document_assessment.is_valid_shareholder_register}
      </span>
    </div>
  </section>

  <!-- 25% 이상 보유자 -->
  <section class="section">
    <div class="section-header">
      <h3>📈 25% 이상 실소유자</h3>
      {#if !isUnknownAnswer(answer.over_25_percent)}
        <span class="count-badge"
          >총 {answer.over_25_percent.length}명 식별</span
        >
      {/if}
    </div>
    {#if isUnknownAnswer(answer.over_25_percent)}
      <div class="unknown-box">
        <span class="unknown-badge">UNKNOWN</span>
        <p>{answer.over_25_percent.reason}</p>
      </div>
    {:else if answer.over_25_percent.length === 0}
      <p class="empty-message">25% 이상 보유자가 없습니다</p>
    {:else}
      <div class="shareholder-list">
        {#each answer.over_25_percent as sh}
          <div class="shareholder-row">
            <span class="name">{sh.name || "(이름 없음)"}</span>
            <span class="type">{getEntityTypeLabel(sh.entity_type)}</span>
            <span class="ratio">{formatRatio(sh.ratio)}</span>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 주주 목록 정렬 기준 -->
  <section class="section">
    <h3>📋 정렬 기준</h3>
    <p>{answer.ordering_rule}</p>
  </section>

  <!-- 추가 정보 -->
  <section class="section">
    <h3>ℹ️ 추가 정보</h3>
    <div class="info-grid">
      <div class="info-item">
        <span class="label">총발행주식수</span>
        <span class="value"
          >{answer.totals.total_shares_declared
            ? formatNumber(answer.totals.total_shares_declared) + "주"
            : "UNKNOWN"}</span
        >
      </div>
      <div class="info-item">
        <span class="label">주식 종류</span>
        <span class="value"
          >{answer.share_classes_found.length > 0
            ? answer.share_classes_found.join(", ")
            : "미확인"}</span
        >
      </div>
    </div>
  </section>

  <!-- 판정 불가 항목 -->
  {#if answer.cannot_determine.length > 0}
    <section class="section warning">
      <h3>⚠️ 판정 불가 항목</h3>
      <ul class="cannot-determine-list">
        {#each answer.cannot_determine as item}
          <li>{item}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- 검증 요약 -->
  {#if answer.validation_summary.triggers.length > 0}
    <section class="section">
      <h3>🔍 검증 결과</h3>
      <div
        class="validation-status status-{answer.validation_summary.status.toLowerCase()}"
      >
        {answer.validation_summary.status}
      </div>
      <div class="trigger-list">
        {#each answer.validation_summary.triggers as trigger}
          <div class="trigger-mini severity-{trigger.severity.toLowerCase()}">
            <span class="severity">{trigger.severity}</span>
            <span class="message">{trigger.message}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .answer-display {
    background: linear-gradient(145deg, #1a1a2e, #16213e);
    border-radius: 16px;
    padding: 2rem;
    border: 1px solid #3d3d5c;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #3d3d5c;
  }

  h2 {
    color: #e2e8f0;
    font-size: 1.5rem;
    margin: 0;
  }

  .trust-badge {
    padding: 0.5rem 1rem;
    border-radius: 20px;
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .section {
    margin-bottom: 1.5rem;
    padding: 1.25rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
  }

  .section.highlight {
    background: linear-gradient(
      135deg,
      rgba(0, 217, 255, 0.1),
      rgba(102, 126, 234, 0.1)
    );
    border: 1px solid rgba(0, 217, 255, 0.3);
  }

  .section.warning {
    background: rgba(245, 158, 11, 0.1);
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  h3 {
    color: #00d9ff;
    font-size: 1rem;
    margin: 0 0 1rem;
  }

  .field {
    display: flex;
    gap: 0.5rem;
  }

  .label {
    color: #a0aec0;
  }

  .value {
    color: #e2e8f0;
    font-weight: 600;
  }

  .status-yes {
    color: #10b981;
  }
  .status-no {
    color: #ef4444;
  }
  .status-unknown {
    color: #f59e0b;
  }
  .status-pass {
    color: #10b981;
  }
  .status-need_hitl {
    color: #f59e0b;
  }
  .status-reject {
    color: #ef4444;
  }

  .unknown-box {
    padding: 1rem;
    background: rgba(245, 158, 11, 0.1);
    border-radius: 8px;
    border-left: 3px solid #f59e0b;
  }

  .unknown-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    background: #f59e0b;
    color: #0a0a0a;
    font-size: 0.75rem;
    font-weight: 700;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }

  .unknown-box p {
    color: #fcd34d;
    margin: 0;
    font-size: 0.875rem;
  }

  .major-shareholder {
    text-align: center;
  }

  .shareholder-name {
    font-size: 1.5rem;
    font-weight: 700;
    color: #e2e8f0;
    margin-bottom: 0.5rem;
  }

  .shareholder-details {
    display: flex;
    justify-content: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .entity-type {
    padding: 0.25rem 0.75rem;
    background: rgba(102, 126, 234, 0.2);
    color: #a5b4fc;
    border-radius: 20px;
    font-size: 0.875rem;
  }

  .ratio {
    color: #00d9ff;
    font-size: 1.25rem;
    font-weight: 700;
  }

  .shares {
    color: #a0aec0;
    font-size: 0.875rem;
  }

  .shareholder-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .shareholder-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
  }

  .shareholder-row .name {
    color: #e2e8f0;
    font-weight: 500;
  }

  .shareholder-row .type {
    color: #a0aec0;
    font-size: 0.75rem;
  }

  .shareholder-row .ratio {
    font-size: 1rem;
  }

  .empty-message {
    color: #718096;
    font-style: italic;
    margin: 0;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-item .label {
    font-size: 0.75rem;
    color: #718096;
  }

  .info-item .value {
    font-size: 1rem;
  }

  .cannot-determine-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .cannot-determine-list li {
    padding: 0.5rem 0;
    color: #fcd34d;
    font-size: 0.875rem;
    border-bottom: 1px solid rgba(245, 158, 11, 0.2);
  }

  .cannot-determine-list li:last-child {
    border-bottom: none;
  }

  .validation-status {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 4px;
    font-weight: 600;
    font-size: 0.875rem;
    margin-bottom: 1rem;
    background: rgba(255, 255, 255, 0.1);
  }

  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .trigger-mini {
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.2);
    border-left: 3px solid;
    display: flex;
    gap: 0.75rem;
    align-items: center;
  }

  .trigger-mini.severity-blocker {
    border-left-color: #ef4444;
  }
  .trigger-mini.severity-warning {
    border-left-color: #f59e0b;
  }
  .trigger-mini.severity-info {
    border-left-color: #3b82f6;
  }

  .trigger-mini .severity {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    color: #a0aec0;
  }

  .trigger-mini .message {
    font-size: 0.875rem;
    color: #e2e8f0;
  }

  /* Added Styles */
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .section-header h3 {
    margin: 0;
  }
  .count-badge {
    background: #3b82f6;
    color: white;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 700;
  }
  .major-shareholder-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
</style>
