<!-- File: src/lib/components/UploadPanel.svelte -->
<script lang="ts">
  import { createEventDispatcher } from "svelte";

  const dispatch = createEventDispatcher<{
    uploaded: { runId: string; mode: "FAST" | "MULTI_AGENT" };
  }>();

  // State Management
  let files: FileList | null = $state(null);
  let uploadStatus: "idle" | "uploading" | "navigating" = $state("idle");
  let busyMode: "FAST" | "MULTI_AGENT" | null = $state(null);
  let error: string | null = $state(null);
  let dragOver = $state(false);
  let isProcessingPdf = $state(false);
  let debugLogs: string[] = $state([]);

  // Logic
  let agentsReady = $state(false);
  let loadingPreviews = $state(false);
  let previews: string[] = $state([]);

  // Refs
  let cameraInput: HTMLInputElement | null = $state(null);
  let fileInput: HTMLInputElement | null = $state(null);
  let modeSelectionNode: HTMLDivElement | null = $state(null);

  /**
   * PDF to Image conversion using pdfjs-dist
   */
  async function convertPdfToImages(file: File): Promise<File[]> {
    const pdfjs = await import("pdfjs-dist");
    // @ts-ignore
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const resultFiles: File[] = [];

    const maxPages = Math.min(pdf.numPages, 10); // Limit to 10 pages for safety

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      if (context) {
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", 0.9),
        );

        if (blob) {
          resultFiles.push(
            new File([blob], `${file.name.replace(".pdf", "")}_p${i}.jpg`, {
              type: "image/jpeg",
            }),
          );
        }
      }
    }
    return resultFiles;
  }

  /**
   * Normalize input files: convert PDFs to images, pass through others
   */
  async function processAndSetFiles(rawFiles: FileList | File[]) {
    isProcessingPdf = true;
    error = null;
    const processed: File[] = [];

    try {
      for (const file of Array.from(rawFiles)) {
        if (
          file.type === "application/pdf" ||
          file.name.toLowerCase().endsWith(".pdf")
        ) {
          const images = await convertPdfToImages(file);
          processed.push(...images);
        } else {
          processed.push(file);
        }
      }

      const dt = new DataTransfer();
      processed.forEach((f) => dt.items.add(f));
      files = dt.files;
    } catch (e: any) {
      console.error("[PDF Conversion Error]", e);
      error = "PDF 변환 중 오류가 발생했습니다.";
    } finally {
      isProcessingPdf = false;
    }
  }

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

          const img = new Image();
          img.onload = () => checkReady();
          img.onerror = () => checkReady();
          img.src = url;
        } else {
          newPreviews.push("/file-icon.png");
          checkReady();
        }

        function checkReady() {
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
        }
      }
      previews = newPreviews;
      return () => {
        newPreviews.forEach(URL.revokeObjectURL);
      };
    } else {
      previews = [];
      agentsReady = false;
      loadingPreviews = false;
    }
  });

  function handleCameraClick() {
    const msg = `[${new Date().toLocaleTimeString()}] Camera Click - cameraInput: ${cameraInput ? "exists" : "null"}`;
    debugLogs = [...debugLogs, msg];
    console.log(msg, cameraInput);
    cameraInput?.click();
  }
  function handleFileClick() {
    const msg = `[${new Date().toLocaleTimeString()}] File Click - fileInput: ${fileInput ? "exists" : "null"}`;
    debugLogs = [...debugLogs, msg];
    console.log(msg, fileInput);
    fileInput?.click();
  }

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const combined = files
        ? [...Array.from(files), ...Array.from(input.files)]
        : Array.from(input.files);
      await processAndSetFiles(combined);
      input.value = ""; // Clear for next selection
    }
  }

  async function handleUpload(mode: "FAST" | "MULTI_AGENT" = "MULTI_AGENT") {
    if (!files || files.length === 0) return;

    uploadStatus = "uploading";
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

      // Stage 2: Navigating
      uploadStatus = "navigating";

      // Artificial delay for UX (to show the "success/navigating" state)
      setTimeout(() => {
        dispatch("uploaded", { runId, mode });
      }, 1200);
    } catch (e) {
      error = e instanceof Error ? e.message : "업로드 실패";
      uploadStatus = "idle";
      busyMode = null;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragOver = false;
    if (e.dataTransfer?.files) {
      await processAndSetFiles(e.dataTransfer.files);
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
      if (i !== index) dt.items.add(files[i]);
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
      <button
        type="button"
        class="fluent-btn"
        onclick={handleFileClick}
        disabled={uploadStatus !== "idle"}
      >
        <span class="icon">📂</span>
        <span>파일 선택</span>
      </button>
      <button
        type="button"
        class="fluent-btn camera-btn"
        onclick={handleCameraClick}
        disabled={uploadStatus !== "idle"}
      >
        <span class="icon">📸</span>
        <span>카메라 촬영</span>
      </button>
    </div>
  </div>

  <!-- 드래그 영역 안내 -->
  {#if uploadStatus === "idle" && (!files || files.length === 0)}
    <div class="drop-hint">
      <span class="drop-icon">↓</span>
      <span>또는 파일을 여기에 드래그하세요</span>
    </div>
  {/if}

  <!-- 파일 목록 -->
  {#if files && files.length > 0}
    <div class="file-section">
      <div class="file-section-header">
        <h3>{files.length}개 파일 선택됨</h3>
        <button
          class="clear-btn"
          onclick={clearAll}
          disabled={uploadStatus !== "idle"}>전체 삭제</button
        >
      </div>

      <div class="file-grid">
        {#each previews as preview, i}
          <div class="file-card">
            <img src={preview} alt="미리보기 {i + 1}" />
            <button
              class="remove-btn"
              onclick={() => removeFile(i)}
              aria-label="파일 제거"
              disabled={uploadStatus !== "idle"}
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

  <!-- Analysis Mode Selection / Loading State -->
  <div
    class="mode-selection"
    class:hidden={!files || files.length === 0}
    bind:this={modeSelectionNode}
  >
    {#if uploadStatus !== "idle" || isProcessingPdf}
      <!-- Staged Loading State (Shared for PDF conversion and Server Upload) -->
      <div
        class="loading-card {uploadStatus} {isProcessingPdf
          ? 'pdf-processing'
          : ''}"
      >
        <div class="loading-icon-wrapper">
          {#if isProcessingPdf}
            <span class="mode-icon-lg loader-spin">📄</span>
          {:else if busyMode === "FAST"}
            <span class="mode-icon-lg">⚡</span>
          {:else}
            <span class="mode-icon-lg">🤖</span>
          {/if}
        </div>

        <div class="loading-content">
          <div class="loading-text">
            {#if isProcessingPdf}
              <span class="primary-msg">PDF 이미지로 변환 중...</span>
              <span class="sub-msg"
                >브라우저에서 직접 변환하여 안정성을 높입니다</span
              >
            {:else if uploadStatus === "uploading"}
              <span class="primary-msg">파일 업로드 중...</span>
              <span class="sub-msg"
                >업로드 완료 후 단계별 진행 화면으로 이동합니다</span
              >
            {:else}
              <span class="primary-msg success">업로드 완료</span>
              <span class="sub-msg"
                >분석 단계별 진행 화면으로 이동합니다...</span
              >
            {/if}
          </div>

          <div class="progress-bar-container">
            <div
              class="progress-bar"
              class:navigating={uploadStatus === "navigating"}
              class:infinite={isProcessingPdf || uploadStatus === "uploading"}
            ></div>
          </div>
        </div>
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

  <!-- Debug Panel -->
  <div class="debug-panel">
    <div class="debug-header">
      <strong>🔍 Debug Log</strong>
      <button onclick={() => (debugLogs = [])}>Clear</button>
    </div>
    <div class="debug-content">
      {#if debugLogs.length === 0}
        <span class="debug-empty">버튼을 클릭하면 여기에 로그가 표시됩니다</span
        >
      {:else}
        {#each debugLogs as log}
          <div class="debug-log">{log}</div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  /* Base Styles from previous version preserved */
  .upload-panel {
    padding: 40px 32px;
    max-width: 560px;
    margin: 0 auto;
    background: var(--fluent-bg-layer);
    border: 1px solid var(--fluent-border-subtle);
    border-radius: 8px;
    box-shadow: var(--fluent-shadow-8);
    position: relative;
    overflow: hidden;
    transition: all 0.2s ease;
  }
  .upload-panel.drag-over {
    background: #f0f8ff;
    border-color: var(--fluent-accent);
    box-shadow: 0 0 0 2px var(--fluent-accent);
  }
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
    background: #eff6fc;
    border-radius: 50%;
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

  /* Buttons & Interactions */
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
    transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .fluent-btn:hover:not(:disabled) {
    background: white;
    border-color: var(--fluent-accent);
    color: var(--fluent-accent);
    box-shadow: var(--fluent-shadow-4);
    transform: translateY(-1px);
  }
  .fluent-btn:active:not(:disabled) {
    transform: scale(0.95); /* Tactile Feedback */
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  .fluent-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  /* File Section */
  .file-section {
    width: 100%;
    background: #faf9f8;
    border: 1px solid var(--fluent-border-default);
    border-radius: 4px;
    padding: 16px;
    margin-bottom: 24px;
  }
  .input-guidance {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 12px;
  }
  .input-label {
    font-size: 1rem;
    font-weight: 700;
    color: var(--fluent-accent-dark);
  }
  .helper-text {
    font-size: 0.8rem;
    color: #94a3b8;
  }
  .input-actions-row {
    display: flex;
    gap: 20px;
  }

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
    margin-bottom: 24px;
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
  }

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
    background: #ddd;
    border: 1px solid var(--fluent-border-subtle);
    box-shadow: var(--fluent-shadow-2);
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
    border: none;
    border-radius: 4px;
    color: white;
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s;
  }
  .file-card:hover .remove-btn {
    opacity: 1;
  }
  .remove-btn:hover {
    background: var(--fluent-danger);
    transform: scale(1.1);
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
  }
  .file-name {
    font-size: 11px;
    color: white;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-size {
    font-size: 10px;
    color: #ccc;
  }

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
    background: var(--btn-primary-bg);
    border: 1px solid var(--btn-primary-border);
    color: white;
    box-shadow: var(--btn-3d-shadow);
    border-radius: 12px;
    cursor: pointer;
    transition: all 0.1s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .analyze-btn:hover:not(:disabled) {
    box-shadow: var(--btn-3d-hover-shadow);
    transform: translateY(-2px);
    filter: brightness(1.1);
  }
  .analyze-btn:active:not(:disabled) {
    transform: scale(0.95); /* Tactile Feedback */
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  .analyze-btn:disabled {
    background: #f3f2f1;
    color: #a19f9d;
    cursor: not-allowed;
    border-color: #e1dfdd;
    box-shadow: none;
  }
  .btn-text {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .btn-text .sub {
    font-size: 0.75rem;
    opacity: 0.8;
  }

  /* Secondary Reset Button */
  .btn-secondary {
    padding: 0 1.5rem;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    color: #475569;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    height: 56px;
    transition: all 0.1s;
  }
  .btn-secondary:hover {
    background: #f8fafc;
    border-color: #475569;
    color: #0f172a;
  }
  .btn-secondary:active {
    transform: scale(0.95);
  }

  /* LOADING STATE - NEW DESIGN */
  .loading-card {
    width: 100%;
    padding: 20px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    display: flex;
    align-items: center;
    gap: 20px;
    transition: all 0.3s ease;
  }

  .loading-card.navigating {
    background: #ecfdf5; /* Light Green */
    border-color: #34d399;
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.4);
    }
    70% {
      box-shadow: 0 0 0 10px rgba(52, 211, 153, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
    }
  }

  .loading-icon-wrapper {
    width: 50px;
    height: 50px;
    background: white;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05);
  }
  .mode-icon-lg {
    font-size: 28px;
  }

  .loading-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .loading-text {
    display: flex;
    flex-direction: column;
  }
  .primary-msg {
    font-weight: 700;
    color: #334155;
    font-size: 0.95rem;
  }
  .primary-msg.success {
    color: #059669;
  }
  .sub-msg {
    font-size: 0.8rem;
    color: #64748b;
  }

  .progress-bar-container {
    width: 100%;
    height: 6px;
    background: #e2e8f0;
    border-radius: 3px;
    overflow: hidden;
  }
  .progress-bar {
    height: 100%;
    width: 60%;
    background: #3b82f6;
    border-radius: 3px;
    animation: loading 2s infinite ease-in-out;
    transition: all 0.3s;
  }
  .progress-bar.navigating {
    width: 100%;
    background: #10b981;
    animation: none;
  }

  .progress-bar.infinite {
    animation: loading 2s infinite ease-in-out;
  }

  .pdf-processing {
    background: #f0f9ff !important;
    border-color: #7dd3fc !important;
  }

  .loader-spin {
    animation: spin 3s infinite linear;
    display: inline-block;
  }

  @keyframes spin {
    from {
      transform: rotateY(0deg);
    }
    to {
      transform: rotateY(360deg);
    }
  }

  @keyframes loading {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(250%);
    }
  }

  .error-toast {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: #fee2e2;
    color: #dc2626;
    padding: 10px 20px;
    border-radius: 20px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    font-size: 0.9rem;
    border: 1px solid #fecaca;
  }

  /* Debug Panel Styles */
  .debug-panel {
    margin-top: 24px;
    background: #1e293b;
    border: 1px solid #334155;
    border-radius: 8px;
    overflow: hidden;
    font-family: monospace;
    font-size: 12px;
  }
  .debug-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: #0f172a;
    color: #94a3b8;
  }
  .debug-header button {
    padding: 2px 8px;
    background: #334155;
    border: none;
    border-radius: 4px;
    color: #94a3b8;
    cursor: pointer;
    font-size: 11px;
  }
  .debug-header button:hover {
    background: #475569;
    color: white;
  }
  .debug-content {
    padding: 12px;
    max-height: 150px;
    overflow-y: auto;
    color: #22c55e;
  }
  .debug-empty {
    color: #64748b;
  }
  .debug-log {
    padding: 4px 0;
    border-bottom: 1px solid #334155;
  }
  .debug-log:last-child {
    border-bottom: none;
  }
</style>
