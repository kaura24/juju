<script lang="ts">
  import type { HITLPacket } from "$lib/types";

  interface Props {
    packet: HITLPacket;
    onResolve?: (resolution: {
      action_taken: string;
      resolved_by: string;
      corrections?: Record<string, unknown>;
    }) => void;
    onCancel?: () => void;
  }

  let { packet, onResolve, onCancel }: Props = $props();

  let actionTaken = $state("");
  let resolvedBy = $state("operator");
  let submitting = $state(false);

  const actionLabels: Record<string, string> = {
    RESCAN_REQUEST: "재스캔 요청",
    MISSING_PAGES_REQUEST: "누락 페이지 요청",
    MANUAL_CORRECTION: "수동 수정",
    DOCUMENT_CLASSIFICATION: "문서 분류",
    REFERENCE_VALUE_INPUT: "기준값 입력",
  };

  const stageLabels: Record<string, string> = {
    B: "문서 판정",
    C: "데이터 추출",
    D: "정규화",
    E: "검증",
  };

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case "BLOCKER":
        return "#ef4444";
      case "WARNING":
        return "#f59e0b";
      case "INFO":
        return "#3b82f6";
      default:
        return "#6b7280";
    }
  }

  async function handleSubmit() {
    if (!actionTaken.trim()) return;

    submitting = true;
    try {
      await onResolve?.({
        action_taken: actionTaken,
        resolved_by: resolvedBy,
      });
    } finally {
      submitting = false;
    }
  }
</script>

<div class="hitl-detail">
  <div class="detail-header">
    <h2>🔧 HITL 처리</h2>
    <button class="close-btn" onclick={() => onCancel?.()}>✕</button>
  </div>

  <!-- 기본 정보 -->
  <section class="section">
    <h3>📋 기본 정보</h3>
    <div class="info-grid">
      <div class="info-item">
        <span class="label">대상 회사</span>
        <span class="value highlight"
          >{packet.context_info?.company_name || "미확인"}</span
        >
      </div>
      <div class="info-item">
        <span class="label">문서 날짜</span>
        <span class="value"
          >{packet.context_info?.document_date || "미기재"}</span
        >
      </div>
      <div class="info-item">
        <span class="label">단계</span>
        <span class="value">{stageLabels[packet.stage] || packet.stage}</span>
      </div>
      <div class="info-item">
        <span class="label">필요 조치</span>
        <span class="value action"
          >{actionLabels[packet.required_action] ||
            packet.required_action}</span
        >
      </div>
      <div class="info-item">
        <span class="label">Run ID</span>
        <span class="value mono">{packet.run_id}</span>
      </div>
      <div class="info-item">
        <span class="label">생성 시간</span>
        <span class="value"
          >{new Date(packet.created_at).toLocaleString("ko-KR")}</span
        >
      </div>
    </div>
  </section>

  <!-- 사유 코드 -->
  <section class="section">
    <h3>🏷️ 사유 코드</h3>
    <div class="reason-codes">
      {#each packet.reason_codes as code}
        <span class="reason-code">{code}</span>
      {/each}
    </div>
  </section>

  <!-- 트리거 상세 -->
  {#if packet.triggers && packet.triggers.length > 0}
    <section class="section">
      <h3>⚠️ 발견된 이슈</h3>
      <div class="trigger-list">
        {#each packet.triggers as trigger}
          <div
            class="trigger-item"
            style="border-left-color: {getSeverityColor(trigger.severity)}"
          >
            <div class="trigger-header">
              <span
                class="severity-badge"
                style="background: {getSeverityColor(trigger.severity)}"
                >{trigger.severity}</span
              >
              <span class="rule-id">{trigger.rule_id}</span>
            </div>
            <p class="trigger-message">{trigger.message}</p>
            {#if trigger.suggestion}
              <p class="trigger-suggestion">
                💡 권장 조치: {trigger.suggestion}
              </p>
            {/if}
            {#if trigger.metrics}
              <details class="trigger-metrics">
                <summary>상세 데이터</summary>
                <pre>{JSON.stringify(trigger.metrics, null, 2)}</pre>
              </details>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- 운영자 노트 -->
  {#if packet.operator_notes && packet.operator_notes.length > 0}
    <section class="section">
      <h3>📝 시스템 노트</h3>
      <ul class="notes-list">
        {#each packet.operator_notes as note}
          <li>{note}</li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- 페이로드 -->
  {#if packet.payload}
    <section class="section">
      <h3>📦 관련 데이터</h3>
      <details class="payload-details">
        <summary>데이터 보기</summary>
        <pre>{JSON.stringify(packet.payload, null, 2)}</pre>
      </details>
    </section>
  {/if}

  <!-- 해결 폼 -->
  <section class="section resolve-section">
    <h3>✅ 조치 완료</h3>

    <div class="form-group">
      <label for="action-taken">수행한 조치 *</label>
      <textarea
        id="action-taken"
        bind:value={actionTaken}
        placeholder="수행한 조치를 입력하세요..."
        rows="3"
      ></textarea>
    </div>

    <div class="form-group">
      <label for="resolved-by">처리자</label>
      <input
        type="text"
        id="resolved-by"
        bind:value={resolvedBy}
        placeholder="처리자 이름"
      />
    </div>

    <div class="button-group">
      <button
        class="cancel-btn"
        onclick={() => onCancel?.()}
        disabled={submitting}
      >
        취소
      </button>
      <button
        class="submit-btn"
        onclick={handleSubmit}
        disabled={!actionTaken.trim() || submitting}
      >
        {#if submitting}
          처리 중...
        {:else}
          조치 완료 및 재개
        {/if}
      </button>
    </div>
  </section>
</div>

<style>
  .hitl-detail {
    background: linear-gradient(145deg, #1a1a2e, #16213e);
    border-radius: 16px;
    padding: 1.5rem;
    border: 1px solid #f59e0b;
    max-height: 80vh;
    overflow-y: auto;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid #3d3d5c;
  }

  h2 {
    color: #f59e0b;
    font-size: 1.25rem;
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #718096;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0.25rem;
    line-height: 1;
  }

  .close-btn:hover {
    color: #e2e8f0;
  }

  .section {
    margin-bottom: 1.5rem;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 12px;
  }

  h3 {
    color: #00d9ff;
    font-size: 0.875rem;
    margin: 0 0 1rem;
  }

  .info-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .info-item {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-item .label {
    color: #718096;
    font-size: 0.75rem;
  }

  .info-item .value {
    color: #e2e8f0;
    font-weight: 500;
  }

  .info-item .value.highlight {
    color: #f59e0b;
    font-weight: 700;
  }

  .info-item .value.action {
    color: #f59e0b;
  }

  .info-item .value.mono {
    font-family: monospace;
    font-size: 0.875rem;
  }

  .reason-codes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .reason-code {
    padding: 0.375rem 0.75rem;
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    border-radius: 6px;
    font-size: 0.75rem;
    font-family: monospace;
  }

  .trigger-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .trigger-item {
    padding: 1rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 8px;
    border-left: 4px solid;
  }

  .trigger-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
  }

  .severity-badge {
    padding: 0.125rem 0.5rem;
    border-radius: 4px;
    color: white;
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .rule-id {
    color: #718096;
    font-family: monospace;
    font-size: 0.75rem;
  }

  .trigger-message {
    color: #e2e8f0;
    margin: 0 0 0.5rem;
  }

  .trigger-suggestion {
    color: #10b981;
    font-size: 0.875rem;
    margin: 0;
  }

  .trigger-metrics {
    margin-top: 0.75rem;
  }

  .trigger-metrics summary {
    color: #718096;
    font-size: 0.75rem;
    cursor: pointer;
  }

  .trigger-metrics pre {
    background: rgba(0, 0, 0, 0.3);
    padding: 0.75rem;
    border-radius: 6px;
    font-size: 0.75rem;
    color: #a0aec0;
    overflow-x: auto;
    margin: 0.5rem 0 0;
  }

  .notes-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .notes-list li {
    padding: 0.5rem 0;
    color: #a0aec0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 0.875rem;
  }

  .notes-list li:last-child {
    border-bottom: none;
  }

  .payload-details summary {
    color: #718096;
    cursor: pointer;
    font-size: 0.875rem;
  }

  .payload-details pre {
    background: rgba(0, 0, 0, 0.3);
    padding: 1rem;
    border-radius: 8px;
    font-size: 0.75rem;
    color: #a0aec0;
    overflow-x: auto;
    margin: 0.75rem 0 0;
    max-height: 300px;
  }

  .resolve-section {
    background: rgba(16, 185, 129, 0.1);
    border: 1px solid rgba(16, 185, 129, 0.3);
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    color: #a0aec0;
    font-size: 0.875rem;
    margin-bottom: 0.5rem;
  }

  .form-group input,
  .form-group textarea {
    width: 100%;
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid #3d3d5c;
    border-radius: 8px;
    color: #e2e8f0;
    font-size: 0.875rem;
    resize: vertical;
  }

  .form-group input:focus,
  .form-group textarea:focus {
    outline: none;
    border-color: #10b981;
  }

  .button-group {
    display: flex;
    gap: 1rem;
    justify-content: flex-end;
  }

  .cancel-btn {
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: 1px solid #4a5568;
    border-radius: 8px;
    color: #a0aec0;
    cursor: pointer;
    font-weight: 500;
  }

  .cancel-btn:hover:not(:disabled) {
    border-color: #718096;
    color: #e2e8f0;
  }

  .submit-btn {
    padding: 0.75rem 1.5rem;
    background: linear-gradient(135deg, #10b981, #059669);
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    font-weight: 600;
  }

  .submit-btn:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
  }

  .submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }
</style>
