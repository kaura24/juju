<script lang="ts">
  import type { StageEvent } from '$lib/types';
  import StageCard from './StageCard.svelte';
  
  interface Props {
    events: StageEvent[];
  }
  
  let { events }: Props = $props();
</script>

<div class="timeline">
  {#if events.length === 0}
    <div class="empty-state">
      <div class="spinner-large"></div>
      <p>분석을 시작하고 있습니다...</p>
    </div>
  {:else}
    <div class="timeline-track">
      {#each events as event, i}
        <div class="timeline-item">
          <div class="timeline-connector">
            <div class="connector-dot" class:active={i === events.length - 1}></div>
            {#if i < events.length - 1}
              <div class="connector-line"></div>
            {/if}
          </div>
          <div class="timeline-content">
            <StageCard {event} isLatest={i === events.length - 1} />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .timeline {
    padding: 1rem 0;
  }
  
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem;
    color: #a0aec0;
  }
  
  .spinner-large {
    width: 48px;
    height: 48px;
    border: 4px solid #2d2d44;
    border-top-color: #00d9ff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .timeline-track {
    display: flex;
    flex-direction: column;
  }
  
  .timeline-item {
    display: flex;
    gap: 1rem;
  }
  
  .timeline-connector {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex-shrink: 0;
    width: 24px;
  }
  
  .connector-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #3d3d5c;
    border: 3px solid #4a5568;
    flex-shrink: 0;
    transition: all 0.3s ease;
  }
  
  .connector-dot.active {
    background: #00d9ff;
    border-color: #00d9ff;
    box-shadow: 0 0 12px rgba(0, 217, 255, 0.5);
  }
  
  .connector-line {
    width: 2px;
    flex: 1;
    background: linear-gradient(180deg, #4a5568, #3d3d5c);
    margin: 4px 0;
  }
  
  .timeline-content {
    flex: 1;
    padding-bottom: 1.5rem;
  }
</style>
