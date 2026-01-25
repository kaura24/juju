<script lang="ts">
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import HitlDetail from '$lib/components/HitlDetail.svelte';
  import type { HITLPacket } from '$lib/types';
  
  let packet: HITLPacket | null = $state(null);
  let loading = $state(true);
  let error: string | null = $state(null);
  let resolving = $state(false);
  
  const packetId = $derived($page.params.id);
  
  async function loadPacket() {
    try {
      const response = await fetch(`/api/hitl/${packetId}`);
      if (!response.ok) {
        throw new Error('HITL packet not found');
      }
      
      const data = await response.json();
      packet = data.packet;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Unknown error';
    } finally {
      loading = false;
    }
  }
  
  async function handleResolve(resolution: { action_taken: string; resolved_by: string; corrections?: Record<string, unknown> }) {
    if (!packet) return;
    
    resolving = true;
    try {
      const response = await fetch(`/api/runs/${packet.run_id}/hitl/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resolution)
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to resolve');
      }
      
      // Run 상세 페이지로 이동
      goto(`/runs/${packet.run_id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to resolve';
    } finally {
      resolving = false;
    }
  }
  
  function handleCancel() {
    goto('/hitl');
  }
  
  onMount(() => {
    loadPacket();
  });
</script>

<svelte:head>
  <title>HITL 처리 - JuJu</title>
</svelte:head>

<main class="hitl-detail-page">
  <header class="page-header">
    <a href="/hitl" class="back-link">← HITL 목록</a>
    <h1>HITL 처리</h1>
  </header>
  
  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>로딩 중...</p>
    </div>
  {:else if error}
    <div class="error-panel">
      <p>❌ {error}</p>
      <a href="/hitl">목록으로 돌아가기</a>
    </div>
  {:else if packet}
    <HitlDetail 
      {packet} 
      onResolve={handleResolve}
      onCancel={handleCancel}
    />
  {/if}
</main>

<style>
  .hitl-detail-page {
    max-width: 900px;
    margin: 0 auto;
    padding: 1rem;
  }
  
  .page-header {
    margin-bottom: 2rem;
  }
  
  .back-link {
    color: #718096;
    text-decoration: none;
    font-size: 0.875rem;
    display: block;
    margin-bottom: 0.5rem;
  }
  
  .back-link:hover {
    color: #a0aec0;
  }
  
  h1 {
    color: #f59e0b;
    font-size: 1.5rem;
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
  
  .error-panel a {
    color: #ef4444;
  }
</style>
