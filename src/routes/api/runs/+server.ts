/** File: src/routes/api/runs/+server.ts */
/**
 * POST /api/runs - 새 Run 생성 (파일 업로드)
 * GET /api/runs - Run 목록 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRun, saveFile, listRuns, updateRunStatus } from '$lib/server/storage';
import { detectEnvironmentAsync } from '$lib/server/envCheck';

export const POST: RequestHandler = async ({ request, platform }) => {
  try {
    const contentType = request.headers.get('content-type') || '';
    let filePaths: string[] = [];
    let fileMetadata: Record<string, { original_name: string }> = {};
    let mode: 'FAST' | 'MULTI_AGENT' | undefined;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const files = formData.getAll('files') as File[];

      const modeVal = formData.get('mode');
      if (modeVal === 'FAST' || modeVal === 'MULTI_AGENT') {
        mode = modeVal;
      }

      if (files.length === 0) {
        return json({ error: '파일이 없습니다' }, { status: 400 });
      }

      for (const file of files) {
        if (file.size === 0) continue;
        const path = await saveFile(file);
        filePaths.push(path);
        fileMetadata[path] = { original_name: file.name };
      }
    } else if (contentType.includes('application/json')) {
      const body = await request.json();
      if (body.mode) mode = body.mode;

      if (body.images && Array.isArray(body.images)) {
        const { saveBase64Image } = await import('$lib/server/storage');
        for (const img of body.images) {
          if (img.base64 && img.mimeType) {
            const path = await saveBase64Image(img.base64, img.mimeType);
            filePaths.push(path);
            // For base64, we don't have original name, so skip metadata or use synthetic name
            fileMetadata[path] = { original_name: `image_${Date.now()}.${img.mimeType.split('/')[1]}` };
          }
        }
      }
    }

    if (filePaths.length === 0) {
      return json({ error: '유효한 파일이 없습니다' }, { status: 400 });
    }

    // Run 생성
    const run = await createRun(filePaths, mode, fileMetadata);

    // 서버리스 환경에서는 즉시 실행하지 않고 큐 상태로만 등록
    const envInfo = await detectEnvironmentAsync();
    if (envInfo.platform !== 'local') {
      await updateRunStatus(run.id, 'queued', 'QUEUE');
      console.log(`[API] Run queued for serverless execution: ${run.id}`);
    } else {
      await updateRunStatus(run.id, 'pending');
    }

    return json({
      runId: run.id,
      message: `${filePaths.length}개 파일 업로드 완료`,
      mode: run.execution_mode,
      debug: {
        hasWaitUntil: !!((platform as any)?.waitUntil),
        executionMode: run.execution_mode,
        modeFromForm: mode,
        envPlatform: envInfo.platform,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[API] POST /api/runs error:', error);
    return json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
};

export const GET: RequestHandler = async () => {
  try {
    const runs = await listRuns();

    return json({
      runs: runs.map(run => ({
        id: run.id,
        status: run.status,
        fileCount: run.files.length,
        currentStage: run.current_stage,
        createdAt: run.created_at,
        updatedAt: run.updated_at
      }))
    });

  } catch (error) {
    console.error('[API] GET /api/runs error:', error);
    return json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
};
