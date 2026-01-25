<script lang="ts">
  /**
   * 25% 이상 대주주 테이블 컴포넌트
   * - 개인/법인 여부
   * - 성명 또는 회사명
   * - 지분율 (내림차순 정렬)
   * - 최대 4명까지 표시
   */

  interface MajorShareholderInfo {
    name: string | null;
    entity_type: "INDIVIDUAL" | "CORPORATE" | "UNKNOWN";
    ratio: number | null;
    shares?: number | null;
  }

  interface Props {
    shareholders?: MajorShareholderInfo[];
    isUnknown?: boolean;
    unknownReason?: string;
  }

  let {
    shareholders = [],
    isUnknown = false,
    unknownReason = "",
  }: Props = $props();

  // 25% 이상 필터링 및 오름차순 정렬, 최대 4명
  const filteredShareholders = $derived(() => {
    if (isUnknown || !shareholders || shareholders.length === 0) {
      return [];
    }

    return shareholders
      .filter((s) => s.ratio !== null && s.ratio >= 25)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0)) // 내림차순
      .slice(0, 4); // 최대 4명
  });

  function getEntityTypeDisplay(type: string): { text: string; class: string } {
    switch (type) {
      case "INDIVIDUAL":
        return { text: "개인", class: "type-individual" };
      case "CORPORATE":
        return { text: "법인", class: "type-corporate" };
      default:
        return { text: "불명", class: "type-unknown" };
    }
  }

  function formatRatio(ratio: number | null): string {
    if (ratio === null) return "-";
    return `${ratio.toFixed(2)}%`;
  }
</script>

<div class="major-shareholders-table">
  <div class="table-header">
    <h3>📊 25% 이상 대주주 현황</h3>
    <span class="subtitle"
      >지분율 내림차순 · 최대 {filteredShareholders().length}명</span
    >
  </div>

  {#if isUnknown}
    <div class="unknown-notice">
      <span class="icon">⚠️</span>
      <div class="message">
        <strong>판별 불가</strong>
        <p>
          {unknownReason ||
            "지분율 정보가 부족하여 25% 이상 보유자를 판별할 수 없습니다."}
        </p>
      </div>
    </div>
  {:else if filteredShareholders().length === 0}
    <div class="empty-notice">
      <span class="icon">ℹ️</span>
      <p>25% 이상 지분을 보유한 주주가 없습니다.</p>
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          <th class="col-rank">순위</th>
          <th class="col-type">구분</th>
          <th class="col-name">성명/회사명</th>
          <th class="col-ratio">지분율</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredShareholders() as shareholder, index}
          {@const entityDisplay = getEntityTypeDisplay(shareholder.entity_type)}
          <tr>
            <td class="col-rank">{index + 1}</td>
            <td class="col-type">
              <span class="entity-badge {entityDisplay.class}">
                {entityDisplay.text}
              </span>
            </td>
            <td class="col-name">
              {shareholder.name || "(이름 없음)"}
            </td>
            <td class="col-ratio">
              <span class="ratio-value">{formatRatio(shareholder.ratio)}</span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    <div class="table-footer">
      <span class="count-info">
        총 {filteredShareholders().length}명의 25% 이상 대주주
      </span>
    </div>
  {/if}
</div>

<style>
  .major-shareholders-table {
    background: linear-gradient(145deg, #1a1a2e, #16213e);
    border-radius: 16px;
    padding: 24px;
    border: 1px solid rgba(99, 102, 241, 0.3);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .table-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .table-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: #f8fafc;
    font-weight: 600;
  }

  .subtitle {
    font-size: 0.8rem;
    color: #94a3b8;
  }

  .unknown-notice,
  .empty-notice {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 20px;
    border-radius: 12px;
    background: rgba(251, 191, 36, 0.1);
    border: 1px solid rgba(251, 191, 36, 0.3);
  }

  .empty-notice {
    background: rgba(148, 163, 184, 0.1);
    border-color: rgba(148, 163, 184, 0.3);
  }

  .unknown-notice .icon,
  .empty-notice .icon {
    font-size: 1.5rem;
  }

  .unknown-notice .message strong {
    display: block;
    color: #fbbf24;
    margin-bottom: 4px;
  }

  .unknown-notice .message p,
  .empty-notice p {
    margin: 0;
    color: #94a3b8;
    font-size: 0.9rem;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead {
    background: rgba(99, 102, 241, 0.2);
  }

  th {
    padding: 14px 16px;
    text-align: left;
    font-weight: 600;
    color: #c7d2fe;
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  th.col-rank {
    width: 60px;
    text-align: center;
  }

  th.col-type {
    width: 80px;
    text-align: center;
  }

  th.col-ratio {
    width: 100px;
    text-align: right;
  }

  tbody tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    transition: background 0.2s;
  }

  tbody tr:hover {
    background: rgba(99, 102, 241, 0.1);
  }

  td {
    padding: 16px;
    color: #e2e8f0;
  }

  td.col-rank {
    text-align: center;
    font-weight: 600;
    color: #94a3b8;
  }

  td.col-type {
    text-align: center;
  }

  td.col-ratio {
    text-align: right;
  }

  .entity-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 20px;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .type-individual {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .type-corporate {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .type-unknown {
    background: rgba(148, 163, 184, 0.2);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.3);
  }

  .col-name {
    font-weight: 500;
  }

  .ratio-value {
    font-family: "SF Mono", "Fira Code", monospace;
    font-size: 1.1rem;
    font-weight: 700;
    color: #a78bfa;
  }

  .table-footer {
    margin-top: 16px;
    padding-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    text-align: right;
  }

  .count-info {
    font-size: 0.85rem;
    color: #94a3b8;
  }
</style>
