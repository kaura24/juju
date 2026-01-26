<!-- File: src/lib/components/UploadPanel.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    uploaded: { runId: string; mode: "FAST" | "MULTI_AGENT" };
  }>();

  let files: FileList | null = $state(null);
  let uploading = $state(false);
  let busyMode: "FAST" | "MULTI_AGENT" | null = $state(null);
  let error: string | null = $state(null);
  let dragOver = $state(false);
  let agentsReady = $state(false); // Track if images are processed and ready
  let loadingPreviews = $state(false);

  // 파일 미리보기
  let previews: string[] = $state([]);

  // 파일 입력 ref
  let cameraInput: HTMLInputElement;
  let fileInput: HTMLInputElement;

  // Mode Selection Node
  let modeSelectionNode: HTMLDivElement;

  $effect(() => {
    if (files && files.length > 0) {
      loadingPreviews = true;
      agentsReady = false;
      const newPreviews: string[] = [];
      let loadedCount = 0;

      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          newPreviews.push(url);

          // Verify image is actually loadable
          const img = new Image();
          img.onload = () => {
            loadedCount++;
            if (loadedCount === files!.length) {
              agentsReady = true;
              loadingPreviews = false;
              // Auto-scroll to buttons when ready
              setTimeout(() => {
                modeSelectionNode?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }, 300); // Increased delay slightly to ensure DOM render
            }
          };
          img.onerror = () => {
            loadedCount++;
            if (loadedCount === files!.length) {
              agentsReady = true;
              loadingPreviews = false;
              setTimeout(() => {
                modeSelectionNode?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
              }, 300);
            }
          };
          img.src = url;
        } else {
          newPreviews.push("/file-icon.png");
          loadedCount++;
          // Non-image files also trigger ready check immediately
          if (loadedCount === files!.length) {
            agentsReady = true;
            loadingPreviews = false;
            setTimeout(() => {
              modeSelectionNode?.scrollIntoView({
                behavior: "smooth",
                block: "center",
              });
            }, 300);
          }
        }
      }

      // Handle case where loop finishes (synchronous parts) but images might be async
      // For non-images mixed or purely non-images, handled above.
      // If loop is empty (shouldn't happen due to if check), do nothing.

      previews = newPreviews;

      // Cleanup
      return () => {
        for (const url of newPreviews) {
          URL.revokeObjectURL(url);
        }
      };
    } else {
      previews = [];
      agentsReady = false;
      loadingPreviews = false;
    }
  });

  function handleCameraClick() {
    cameraInput?.click();
  }

  function handleFileClick() {
    fileInput?.click();
  }

  function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      // 기존 파일에 추가
      if (files) {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        for (const f of input.files) dt.items.add(f);
        files = dt.files;
      } else {
        files = input.files;
      }
    }
  }

  async function handleUpload(mode: "FAST" | "MULTI_AGENT" = "MULTI_AGENT") {
    if (!files || files.length === 0) return;

    uploading = true;
    busyMode = mode;
    error = null;

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }
      formData.append("mode", mode);

      const response = await fetch("/api/runs", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "업로드 실패");
      }

      const { runId } = await response.json();
      dispatch("uploaded", { runId, mode });
    } catch (e) {
      error = e instanceof Error ? e.message : "업로드 실패";
    } finally {
      uploading = false;
      busyMode = null;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;

    if (e.dataTransfer?.files) {
      if (files) {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        for (const f of e.dataTransfer.files) dt.items.add(f);
        files = dt.files;
      } else {
        files = e.dataTransfer.files;
      }
    }
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function removeFile(index: number) {
    if (!files) return;

    const dt = new DataTransfer();
    for (let i = 0; i < files.length; i++) {
      if (i !== index) {
        dt.items.add(files[i]);
      }
    }
    files = dt.files.length > 0 ? dt.files : null;
  }

  function clearAll() {
    files = null;
    previews = [];
  }
</script>

<div
  class="upload-panel"
  class:drag-over={dragOver}
  ondrop={handleDrop}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  role="region"
  aria-label="파일 업로드"
>
  <!-- 헤더 -->
  <div class="panel-header">
    <div class="icon-container">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      >
        <path
          d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </div>
    <h2>주주명부 분석</h2>
    <p class="subtitle">이미지 또는 PDF 파일을 업로드하세요</p>
  </div>

  <!-- File Input Section with Guidance -->
  <div class="file-section">
    <div class="input-guidance">
      <label class="input-label" for="file-upload-input"
        >주주명부 파일 업로드</label
      >
      <span class="helper-text">PDF, JPG, TIFF 파일을 지원합니다.</span>
    </div>

    <!-- Hidden Inputs -->
    <input
      id="file-upload-input"
      bind:this={fileInput}
      type="file"
      accept=".pdf,.jpg,.jpeg,.tif,.tiff"
      multiple
      onchange={handleFileChange}
      style="display: none;"
    />
    <input
      bind:this={cameraInput}
      type="file"
      accept="image/*"
      capture="environment"
      onchange={handleFileChange}
      style="display: none;"
    />

    <div class="input-actions-row">
      <button class="fluent-btn" onclick={handleFileClick}>
        <span class="icon">📂</span>
        <span>파일 선택</span>
      </button>
      <button class="fluent-btn camera-btn" onclick={handleCameraClick}>
        <span class="icon">📸</span>
        <span>카메라 촬영</span>
      </button>
    </div>
  </div>

  <!-- 드래그 영역 안내 -->
  <div class="drop-hint">
    <span class="drop-icon">↓</span>
    <span>또는 파일을 여기에 드래그하세요</span>
  </div>

  <!-- 파일 목록 -->
  {#if files && files.length > 0}
    <div class="file-section">
      <div class="file-section-header">
        <h3>{files.length}개 파일 선택됨</h3>
        <button class="clear-btn" onclick={clearAll}>전체 삭제</button>
      </div>

      <div class="file-grid">
        {#each previews as preview, i}
          <div class="file-card">
            <img src={preview} alt="미리보기 {i + 1}" />
            <button
              class="remove-btn"
              onclick={() => removeFile(i)}
              aria-label="파일 제거"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <div class="file-info">
              <span class="file-name">{files[i]?.name.slice(0, 12)}...</span>
              <span class="file-size"
                >{(files[i]?.size / 1024).toFixed(0)} KB</span
              >
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Analysis Mode Selection with Hierarchy -->
  <div
    class="mode-selection"
    class:hidden={!files || files.length === 0}
    bind:this={modeSelectionNode}
  >
    {#if uploading}
      <!-- Feedback State: Loading -->
      <div class="loading-state">
        <div class="spinner"></div>
        <span>분석 중입니다...</span>
      </div>
    {:else}
      <!-- Secondary Action: Reset -->
      <button class="btn-secondary" onclick={clearAll}> 초기화 </button>

      <!-- Primary Actions -->
      <button
        onclick={() => handleUpload("FAST")}
        disabled={!agentsReady}
        class="analyze-btn fast-track"
        title="빠른 분석 (10초 이내)"
      >
        <span class="btn-icon">⚡</span>
        <div class="btn-text">
          <span class="main">빠른 분석</span>
          <span class="sub">Fast Track</span>
        </div>
      </button>

      <button
        onclick={() => handleUpload("MULTI_AGENT")}
        disabled={!agentsReady}
        class="analyze-btn multi-agent"
        title="정밀 분석 (단계별 검증)"
      >
        <span class="btn-icon">🤖</span>
        <div class="btn-text">
          <span class="main">심층 분석</span>
          <span class="sub">Multi-Agent</span>
        </div>
      </button>
    {/if}
  </div>

  {#if error}
    <div class="error-toast">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
      <span>{error}</span>
    </div>
  {/if}
</div>

<style>
  /* Fluent Design System Variables */
  .upload-panel {
    padding: 40px 32px;
    max-width: 560px;
    margin: 0 auto;

    /* Fluent Light Card */
    background: var(--fluent-bg-layer); /* White */
    border: 1px solid var(--fluent-border-subtle);
    border-radius: 8px; /* Classic Office Radius */
    box-shadow: var(--fluent-shadow-8);

    position: relative;
    overflow: hidden;
    transition: all 0.2s ease;
  }

  /* Remove noise/gradient overlay */
  .upload-panel::before {
    display: none;
  }

  .upload-panel.drag-over {
    background: #f0f8ff; /* Lightest Blue */
    border-color: var(--fluent-accent);
    box-shadow: 0 0 0 2px var(--fluent-accent);
  }

  /* Header */
  .panel-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }

  .icon-container {
    width: 64px;
    height: 64px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #eff6fc; /* Light Blue tint */
    border-radius: 50%; /* Circle icon generic to Office */
    color: var(--fluent-accent);
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 700;
    color: var(--fluent-text-primary);
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 0;
    font-size: 14px;
    color: var(--fluent-text-secondary);
  }

  .fluent-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 20px;

    /* Jewel-tone Green 3D for Input Actions */
    background: var(--btn-success-bg);
    border: 1px solid var(--btn-success-border);
    border-radius: 12px;

    color: white;
    font-size: 14px;
    font-weight: 700; /* Bolder text */
    cursor: pointer;
    box-shadow: var(--btn-3d-shadow);

    transition: all 0.2s ease;
  }

  .fluent-btn:hover {
    box-shadow: var(--btn-3d-hover-shadow);
    filter: brightness(1.1);
    transform: translateY(-2px);
  }

  .fluent-btn:active {
    transform: translateY(1px);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  .fluent-btn:active {
    transform: scale(0.98);
    background: rgba(255, 255, 255, 0.05);
  }

  .camera-btn:hover {
    border-color: var(--fluent-accent);
  }

  /* Drop Hint */
  .drop-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px dashed var(--fluent-accent);
    border-radius: 8px;
    font-size: 13px;
    color: var(--fluent-accent-light);
  }

  .drop-icon {
    animation: bounce 1.5s infinite;
  }

  @keyframes bounce {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(3px);
    }
  }

  /* File Section */
  .file-section {
    width: 100%;
    background: #faf9f8; /* Very Light Grey */
    border: 1px solid var(--fluent-border-default);
    border-radius: 4px;
    padding: 16px;
  }

  .file-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .file-section-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--fluent-text-primary);
  }

  .clear-btn {
    padding: 4px 8px;
    background: transparent;
    border: none;
    color: var(--fluent-accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .clear-btn:hover {
    text-decoration: underline;
    background: transparent;
  }

  /* File Grid */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 12px;
  }

  .file-card {
    position: relative;
    aspect-ratio: 1;
    border-radius: 12px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--fluent-border-subtle);
    transition: all 0.15s ease;
    box-shadow: var(--fluent-shadow-2);
  }

  .file-card:hover {
    border-color: var(--fluent-border-hover);
    transform: translateY(-2px);
  }

  .file-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .remove-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(10px);
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
  }

  .file-card:hover .remove-btn {
    opacity: 1;
  }

  .remove-btn:hover {
    background: var(--fluent-danger);
  }

  .file-info {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 8px;
    background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .file-name {
    font-size: 11px;
    color: var(--fluent-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-size {
    font-size: 10px;
    color: var(--fluent-text-tertiary);
  }

  .input-actions-row {
    display: flex;
    gap: 20px; /* Increased spacing for better visibility */
  }

  .input-label {
    font-size: 1rem;
    font-weight: 700;
    color: var(--fluent-accent-dark); /* Dark Navy for authority */
  }

  /* Analyze Button */
  /* Mode Selection */
  .mode-selection {
    display: flex;
    gap: 12px;
    width: 100%;
  }

  @media (max-width: 480px) {
    .mode-selection {
      flex-direction: column;
    }
  }

  .mode-selection.hidden {
    display: none;
  }

  .analyze-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 16px;
    border: 1px solid transparent;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    transition: background 0.1s;
    position: relative;
    overflow: hidden;
  }

  .analyze-btn:disabled:not(.is-busy) {
    background: #f3f2f1;
    color: #a19f9d;
    cursor: not-allowed;
    border-color: #e1dfdd;
  }

  /* Analyze Button - Premium Blue Gradient */
  .analyze-btn.multi-agent,
  .analyze-btn.fast-track {
    background: var(--btn-primary-bg);
    border: 1px solid var(--btn-primary-border);
    color: white;
    box-shadow: var(--btn-3d-shadow);
    border-radius: 12px;
  }

  .analyze-btn.multi-agent:hover,
  .analyze-btn.fast-track:hover {
    box-shadow: var(--btn-3d-hover-shadow);
    transform: translateY(-2px);
    filter: brightness(1.1);
  }

  .analyze-btn.multi-agent:active,
  .analyze-btn.fast-track:active {
    transform: translateY(1px);
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  }

  /* Remove Jewel/3D Styles */
  .analyze-btn.fast-track,
  .analyze-btn.multi-agent {
    /* Reset specific 3D styles */
    border: none;
  }

  .btn-text .sub {
    font-size: 0.75rem;
    opacity: 0.8;
  }

  /* Secondary Button (Reset) - Standard Outline */
  .btn-secondary {
    padding: 0 1.5rem;
    background: #ffffff;
    border: 1px solid #cbd5e1; /* Slate 300 */
    color: #475569; /* Slate 600 */
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.1s;
    height: 56px;
  }

  .btn-secondary:hover {
    background: #f8fafc; /* Slate 50 */
    border-color: #475569;
    color: #0f172a;
  }

  /* Input Actions (File/Camera) - Noir/Slate Style */
  .fluent-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 20px;

    background: var(--btn-noir-bg);
    border: 1px solid var(--btn-noir-border);
    border-radius: 8px;

    color: var(--btn-noir-text);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--fluent-shadow-2);

    transition: all 0.1s ease;
  }

  .fluent-btn:hover {
    background: white;
    border-color: var(--fluent-accent); /* Tech Blue hover */
    color: var(--fluent-accent);
    box-shadow: var(--fluent-shadow-4);
    transform: translateY(-1px);
  }

  .loading-state {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    color: #334155;
    font-size: 0.95rem;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 3px solid rgba(37, 99, 235, 0.2); /* Faint Blue */
    border-top-color: var(--fluent-accent); /* Tech Blue */
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .btn-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    line-height: 1.25;
  }

  .main {
    font-weight: 700;
    font-size: 1rem;
  }

  .sub {
    font-size: 0.8rem;
    opacity: 0.85;
    font-weight: 400;
  }

  /* Error Toast */
  .error-toast {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px 16px;
    background: #fef2f2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    color: #991b1b;
    font-size: 14px;
    margin-top: 12px;
  }
</style>
