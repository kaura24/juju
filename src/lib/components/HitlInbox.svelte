<script lang="ts">
  import type { HITLPacket } from "$lib/types";
  import html2canvas from "html2canvas";

  interface Props {
    packets: Array<{
      id: string;
      runId: string;
      stage: string;
      reasonCodes: string[];
      requiredAction: string;
      operatorNotes: string[];
      createdAt: string;
    }>;
    onSelect?: (packetId: string) => void;
  }

  let { packets, onSelect }: Props = $props();
  let isCapturing = $state(false);

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

  function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleString("ko-KR", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  async function captureHitl() {
    const element = document.querySelector(".hitl-inbox") as HTMLElement;
    if (!element) return;

    try {
      isCapturing = true;
      const canvas = await html2canvas(element, {
        backgroundColor: "#1a1a2e",
        scale: 2, // 고해상도 캡쳐
      });

      const image = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = image;
      a.download = `hitl-inbox-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    } catch (err) {
      console.error("캡쳐 실패:", err);
    } finally {
      isCapturing = false;
    }
  }
</script>

<div class="hitl-inbox">
  <div class="inbox-header">
    <div class="header-left">
      <h2>⚠️ HITL 대기열</h2>
      <span class="count-badge">{packets.length}</span>
    </div>
    <button
      class="capture-badge-btn"
      onclick={captureHitl}
      disabled={isCapturing}
      title="HITL 대기열 캡쳐"
    >
      {isCapturing ? "⏳" : "📸 캡쳐"}
    </button>
  </div>

  {#if packets.length === 0}
    <div class="empty-state">
      <span class="icon">✅</span>
      <p>처리 대기 중인 항목이 없습니다</p>
    </div>
  {:else}
    <div class="packet-list">
      {#each packets as packet}
        <button class="packet-card" onclick={() => onSelect?.(packet.id)}>
          <div class="card-header">
            <span class="stage-badge"
              >{stageLabels[packet.stage] || packet.stage}</span
            >
            <span class="time">{formatTime(packet.createdAt)}</span>
          </div>

          <div class="action-label">
            {actionLabels[packet.requiredAction] || packet.requiredAction}
          </div>

          <div class="reason-tags">
            {#each packet.reasonCodes.slice(0, 2) as code}
              <span class="reason-tag">{code}</span>
            {/each}
            {#if packet.reasonCodes.length > 2}
              <span class="more">+{packet.reasonCodes.length - 2}</span>
            {/if}
          </div>

          {#if packet.operatorNotes.length > 0}
            <p class="note">{packet.operatorNotes[0]}</p>
          {/if}

          <div class="card-footer">
            <span class="run-id">Run: {packet.runId.slice(0, 8)}...</span>
            <span class="arrow">→</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .hitl-inbox {
    background: linear-gradient(145deg, #1a1a2e, #16213e);
    border-radius: 16px;
    padding: 1.5rem;
    border: 1px solid #3d3d5c;
  }

  .inbox-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.5rem;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  h2 {
    color: #f59e0b;
    font-size: 1.25rem;
    margin: 0;
  }

  .count-badge {
    background: #f59e0b;
    color: #0a0a0a;
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-weight: 700;
    font-size: 0.875rem;
  }

  .capture-badge-btn {
    background: #cba6f7;
    color: #11111b;
    border: none;
    border-radius: 20px;
    padding: 4px 12px;
    font-size: 0.75rem;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .capture-badge-btn:hover:not(:disabled) {
    background: #b4befe;
    transform: translateY(-1px);
  }

  .capture-badge-btn:disabled {
    opacity: 0.5;
    background: #6c7086;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 3rem;
    color: #718096;
  }

  .empty-state .icon {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .packet-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .packet-card {
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid #3d3d5c;
    border-radius: 12px;
    padding: 1.25rem;
    cursor: pointer;
    transition: all 0.2s ease;
    text-align: left;
    width: 100%;
  }

  .packet-card:hover {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.1);
    transform: translateX(4px);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.75rem;
  }

  .stage-badge {
    padding: 0.25rem 0.5rem;
    background: rgba(102, 126, 234, 0.2);
    color: #a5b4fc;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .time {
    color: #718096;
    font-size: 0.75rem;
  }

  .action-label {
    color: #e2e8f0;
    font-weight: 600;
    font-size: 1rem;
    margin-bottom: 0.75rem;
  }

  .reason-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .reason-tag {
    padding: 0.125rem 0.5rem;
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
    border-radius: 4px;
    font-size: 0.625rem;
    font-family: monospace;
  }

  .more {
    color: #718096;
    font-size: 0.75rem;
  }

  .note {
    color: #a0aec0;
    font-size: 0.875rem;
    margin: 0 0 0.75rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 0.75rem;
    border-top: 1px solid #3d3d5c;
  }

  .run-id {
    color: #718096;
    font-size: 0.75rem;
    font-family: monospace;
  }

  .arrow {
    color: #f59e0b;
    font-weight: 600;
  }
</style>
