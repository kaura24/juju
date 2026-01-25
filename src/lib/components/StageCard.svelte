<script lang="ts">
  import type { StageEvent } from '$lib/types';
  
  interface Props {
    event: StageEvent;
    isLatest?: boolean;
  }
  
  let { event, isLatest = false }: Props = $props();
  
  const stageNames: Record<string, string> = {
    'B': '문서 판정',
    'C': '데이터 추출',
    'D': '정규화',
    'E': '검증',
    'INSIGHTS': '분석 완료'
  };
  
  const stageIcons: Record<string, string> = {
    'B': '🔍',
    'C': '📊',
    'D': '⚙️',
    'E': '✅',
    'INSIGHTS': '💡'
  };
  
  const actionColors: Record<string, string> = {
    'AUTO_NEXT': '#10b981',
    'HITL': '#f59e0b',
    'REJECT': '#ef4444',
    'AUTO_RETRY': '#6366f1'
  };
  
  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'BLOCKER': return '#ef4444';
      case 'WARNING': return '#f59e0b';
      case 'INFO': return '#3b82f6';
      default: return '#6b7280';
    }
  }
</script>

<div class="stage-card" class:latest={isLatest}>
  <div class="card-header">
    <div class="stage-info">
      <span class="stage-icon">{stageIcons[event.stage_name] || '📋'}</span>
      <span class="stage-name">{stageNames[event.stage_name] || event.stage_name}</span>
    </div>
    <div class="action-badge" style="background-color: {actionColors[event.next_action] || '#6b7280'}">
      {event.next_action}
    </div>
  </div>
  
  <div class="card-body">
    <p class="summary">{event.summary}</p>
    
    {#if event.rationale}
      <p class="rationale">{event.rationale}</p>
    {/if}
    
    <div class="confidence-bar">
      <div class="confidence-fill" style="width: {event.confidence * 100}%"></div>
      <span class="confidence-text">{(event.confidence * 100).toFixed(0)}%</span>
    </div>
  </div>
  
  {#if event.triggers && event.triggers.length > 0}
    <div class="triggers">
      <h4>발견된 이슈</h4>
      {#each event.triggers as trigger}
        <div class="trigger-item" style="border-left-color: {getSeverityColor(trigger.severity)}">
          <span class="trigger-severity">{trigger.severity}</span>
          <span class="trigger-id">{trigger.rule_id}</span>
          <p class="trigger-message">{trigger.message}</p>
          {#if trigger.suggestion}
            <p class="trigger-suggestion">💡 {trigger.suggestion}</p>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  
  <div class="card-footer">
    <span class="timestamp">
      {new Date(event.timestamp).toLocaleTimeString('ko-KR')}
    </span>
  </div>
</div>

<style>
  .stage-card {
    background: linear-gradient(145deg, #1e1e2e, #252540);
    border-radius: 12px;
    padding: 1.25rem;
    border: 1px solid #3d3d5c;
    transition: all 0.3s ease;
  }
  
  .stage-card.latest {
    border-color: #00d9ff;
    box-shadow: 0 0 20px rgba(0, 217, 255, 0.2);
  }
  
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  
  .stage-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  
  .stage-icon {
    font-size: 1.5rem;
  }
  
  .stage-name {
    font-weight: 600;
    color: #e2e8f0;
    font-size: 1.1rem;
  }
  
  .action-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 20px;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    text-transform: uppercase;
  }
  
  .card-body {
    margin-bottom: 1rem;
  }
  
  .summary {
    color: #e2e8f0;
    font-size: 1rem;
    margin: 0 0 0.5rem;
    font-weight: 500;
  }
  
  .rationale {
    color: #a0aec0;
    font-size: 0.875rem;
    margin: 0 0 1rem;
  }
  
  .confidence-bar {
    height: 8px;
    background: #2d2d44;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
  }
  
  .confidence-fill {
    height: 100%;
    background: linear-gradient(90deg, #00d9ff, #00b4d8);
    border-radius: 4px;
    transition: width 0.5s ease;
  }
  
  .confidence-text {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 0.625rem;
    color: #e2e8f0;
    font-weight: 600;
  }
  
  .triggers {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
  }
  
  .triggers h4 {
    color: #f59e0b;
    font-size: 0.875rem;
    margin: 0 0 0.75rem;
  }
  
  .trigger-item {
    padding: 0.75rem;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 6px;
    border-left: 3px solid;
    margin-bottom: 0.5rem;
  }
  
  .trigger-item:last-child {
    margin-bottom: 0;
  }
  
  .trigger-severity {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.1);
    color: #e2e8f0;
  }
  
  .trigger-id {
    font-size: 0.75rem;
    color: #718096;
    margin-left: 0.5rem;
    font-family: monospace;
  }
  
  .trigger-message {
    color: #e2e8f0;
    font-size: 0.875rem;
    margin: 0.5rem 0 0;
  }
  
  .trigger-suggestion {
    color: #10b981;
    font-size: 0.8rem;
    margin: 0.25rem 0 0;
  }
  
  .card-footer {
    display: flex;
    justify-content: flex-end;
  }
  
  .timestamp {
    font-size: 0.75rem;
    color: #718096;
  }
</style>
