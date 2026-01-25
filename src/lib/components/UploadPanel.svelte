<!-- File: src/lib/components/UploadPanel.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    uploaded: { runId: string; mode: "FAST" | "MULTI_AGENT" };
  }>();

  let files: FileList | null = $state(null);
  let uploading = $state(false);
  let error: string | null = $state(null);
  let dragOver = $state(false);

  // 파일 미리보기
  let previews: string[] = $state([]);

  // 파일 입력 ref
  let cameraInput: HTMLInputElement;
  let fileInput: HTMLInputElement;

  $effect(() => {
    if (files) {
      const newPreviews: string[] = [];
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const url = URL.createObjectURL(file);
          newPreviews.push(url);
        } else if (file.type === "application/pdf") {
          // PDF는 아이콘이나 썸네일 대신 기본 이미지를 쓰거나 일단 스킵 (나중에 PDF 썸네일 로직 추가 가능)
          newPreviews.push("/pdf-icon.png"); // placeholder or logic to skip
        } else {
          newPreviews.push("/file-icon.png");
        }
      }
      previews = newPreviews;

      // Cleanup
      return () => {
        for (const url of newPreviews) {
          URL.revokeObjectURL(url);
        }
      };
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
    error = null;

    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append("files", file);
      }

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

  <!-- 숨겨진 input들 -->
  <input
    type="file"
    accept="image/*"
    capture="environment"
    bind:this={cameraInput}
    onchange={handleFileChange}
    style="display: none;"
  />
  <input
    type="file"
    accept="image/*,application/pdf,.tif,.tiff"
    multiple
    bind:this={fileInput}
    onchange={handleFileChange}
    style="display: none;"
  />

  <!-- 버튼 그룹 -->
  <div class="button-group">
    <button class="fluent-btn camera-btn" onclick={handleCameraClick}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          cx="12"
          cy="13"
          r="4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>카메라 촬영</span>
    </button>

    <button class="fluent-btn file-btn" onclick={handleFileClick}>
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path
          d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>파일 선택</span>
    </button>
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

  <!-- 분석 모드 선택 버튼 -->
  <div class="mode-selection" class:hidden={!files || files.length === 0}>
    <button
      onclick={() => handleUpload("FAST")}
      disabled={uploading}
      class="analyze-btn fast-track"
    >
      {#if uploading}
        <div class="spinner"></div>
        <span>분석 시작 중...</span>
      {:else}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <polygon
            points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div class="btn-text">
          <span class="main-text">Fast Track</span>
          <span class="sub-text">빠른 분석 (10초 이내)</span>
        </div>
      {/if}
    </button>

    <button
      onclick={() => handleUpload("MULTI_AGENT")}
      disabled={uploading}
      class="analyze-btn multi-agent"
    >
      {#if uploading}
        <div class="spinner"></div>
        <span>분석 시작 중...</span>
      {:else}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
          <circle cx="9" cy="7" r="4"></circle>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
        </svg>
        <div class="btn-text">
          <span class="main-text">Multi-Agent</span>
          <span class="sub-text">정밀 분석 (단계별 검증)</span>
        </div>
      {/if}
    </button>
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
    --fluent-bg: rgba(32, 32, 32, 0.85);
    --fluent-bg-hover: rgba(45, 45, 45, 0.9);
    --fluent-border: rgba(255, 255, 255, 0.08);
    --fluent-border-hover: rgba(255, 255, 255, 0.15);
    --fluent-accent: #0078d4;
    --fluent-accent-hover: #1a86d9;
    --fluent-accent-secondary: #60cdff;
    --fluent-text: #ffffff;
    --fluent-text-secondary: rgba(255, 255, 255, 0.7);
    --fluent-text-tertiary: rgba(255, 255, 255, 0.5);
    --fluent-danger: #ff6b6b;
    --fluent-success: #4cd964;
    --fluent-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    --fluent-shadow-lg: 0 16px 48px rgba(0, 0, 0, 0.5);

    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 40px 32px;
    max-width: 560px;
    margin: 0 auto;

    /* Acrylic Material */
    background: var(--fluent-bg);
    backdrop-filter: blur(40px) saturate(150%);
    -webkit-backdrop-filter: blur(40px) saturate(150%);

    /* Border & Shadow */
    border: 1px solid var(--fluent-border);
    border-radius: 8px;
    box-shadow: var(--fluent-shadow);

    /* Subtle noise texture */
    position: relative;
    overflow: hidden;

    transition: all 0.2s ease;
  }

  .upload-panel::before {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      135deg,
      rgba(255, 255, 255, 0.03) 0%,
      transparent 50%
    );
    pointer-events: none;
  }

  .upload-panel.drag-over {
    border-color: var(--fluent-accent);
    box-shadow:
      var(--fluent-shadow-lg),
      0 0 0 1px var(--fluent-accent);
    transform: scale(1.01);
  }

  /* Header */
  .panel-header {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .icon-container {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(
      135deg,
      var(--fluent-accent),
      var(--fluent-accent-secondary)
    );
    border-radius: 16px;
    color: white;
  }

  h2 {
    margin: 0;
    font-size: 24px;
    font-weight: 600;
    color: var(--fluent-text);
    letter-spacing: -0.02em;
  }

  .subtitle {
    margin: 0;
    font-size: 14px;
    color: var(--fluent-text-secondary);
  }

  /* Button Group */
  .button-group {
    display: flex;
    gap: 12px;
    width: 100%;
  }

  .fluent-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 14px 20px;

    background: var(--fluent-bg-hover);
    border: 1px solid var(--fluent-border);
    border-radius: 6px;

    color: var(--fluent-text);
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;

    transition: all 0.15s ease;
  }

  .fluent-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    border-color: var(--fluent-border-hover);
  }

  .fluent-btn:active {
    transform: scale(0.98);
    background: rgba(255, 255, 255, 0.05);
  }

  .camera-btn:hover {
    border-color: var(--fluent-accent);
  }

  .file-btn:hover {
    border-color: var(--fluent-accent-secondary);
  }

  /* Drop Hint */
  .drop-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    font-size: 13px;
    color: var(--fluent-text-tertiary);
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
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
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
    font-weight: 500;
    color: var(--fluent-accent-secondary);
  }

  .clear-btn {
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--fluent-border);
    border-radius: 4px;
    color: var(--fluent-text-tertiary);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .clear-btn:hover {
    background: rgba(255, 107, 107, 0.1);
    border-color: var(--fluent-danger);
    color: var(--fluent-danger);
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
    border-radius: 6px;
    overflow: hidden;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid var(--fluent-border);
    transition: all 0.15s ease;
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

  /* Analyze Button */
  /* Mode Selection */
  .mode-selection {
    display: flex;
    gap: 12px;
    width: 100%;
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
    border: none;
    border-radius: 8px;
    color: white;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .analyze-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    filter: grayscale(1);
  }

  .analyze-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .analyze-btn:active:not(:disabled) {
    transform: translateY(0);
  }

  /* Fast Track Button */
  .analyze-btn.fast-track {
    background: linear-gradient(135deg, #ff512f 0%, #dd2476 100%);
  }

  .analyze-btn.fast-track::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.15),
      transparent
    );
    pointer-events: none;
  }

  /* Multi-Agent Button */
  .analyze-btn.multi-agent {
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .analyze-btn.multi-agent::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.15),
      transparent
    );
    pointer-events: none;
  }

  .btn-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
  }

  .main-text {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.2;
  }

  .sub-text {
    font-size: 11px;
    opacity: 0.9;
    font-weight: 400;
  }

  /* Spinner */
  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* Error Toast */
  .error-toast {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 14px 16px;
    background: rgba(255, 107, 107, 0.15);
    border: 1px solid rgba(255, 107, 107, 0.3);
    border-radius: 6px;
    color: var(--fluent-danger);
    font-size: 14px;
  }
</style>
