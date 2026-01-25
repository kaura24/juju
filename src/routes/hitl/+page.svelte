<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import HitlInbox from '$lib/components/HitlInbox.svelte';
  
  interface PacketItem {
    id: string;
    runId: string;
    stage: string;
    reasonCodes: string[];
    requiredAction: string;
    operatorNotes: string[];
    createdAt: string;
  }
  
  let packets: PacketItem[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  
  async function loadPackets() {
    try {
      const response = await fetch('/api/hitl');
      if (!response.ok) {
        throw new Error('Failed to load HITL packets');
      }
      
      const data = await response.json();
      packets = data.packets;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }
  
  function handleSelect(packetId: string) {
    goto(`/hitl/${packetId}`);
  }
  
  onMount(() => {
    loadPackets();
    
    // 30초마다 새로고침
    const interval = setInterval(loadPackets, 30000);
    return () => clearInterval(interval);
  });
</script>

<svelte:head>
  <title>HITL 대기열 - JuJu</title>
</svelte:head>

<main class="hitl-page">
  <header class="page-header">
    <h1>⚠️ HITL 대기열</h1>
    <p>자동 처리 중 문제가 발견되어 확인이 필요한 항목들입니다</p>
  </header>
  
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>로딩 중...</p>
    </div>
  {:else if error}
    <div class="error-panel">
      <p>❌ {error}</p>
      <button onclick={() => loadPackets()}>다시 시도</button>
    </div>
  {:else}
    <HitlInbox {packets} onSelect={handleSelect} />
  {/if}
</main>

<style>
  .hitl-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 1rem;
  }
  
  .page-header {
    margin-bottom: 2rem;
  }
  
  h1 {
    color: #f59e0b;
    font-size: 1.75rem;
    margin: 0 0 0.5rem;
  }
  
  .page-header p {
    color: #a0aec0;
    margin: 0;
  }
  
  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4rem;
    color: #718096;
  }
  
  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid #2d2d44;
    border-top-color: #f59e0b;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 1rem;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  .error-panel {
    text-align: center;
    padding: 2rem;
    background: rgba(239, 68, 68, 0.1);
    border-radius: 12px;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }
  
  .error-panel p {
    color: #fca5a5;
    margin: 0 0 1rem;
  }
  
  .error-panel button {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #ef4444;
    border-radius: 6px;
    color: #ef4444;
    cursor: pointer;
  }
  
  .error-panel button:hover {
    background: rgba(239, 68, 68, 0.1);
  }
</style>
