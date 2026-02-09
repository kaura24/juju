/** File: src/routes/api/runs/+server.ts */
/**
 * POST /api/runs - 새 Run 생성 (파일 업로드)
 * GET /api/runs - Run 목록 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createRun, saveFile, listRuns } from '$lib/server/storage';
import { executeRun } from '$lib/server/orchestrator';
import { acquireSessionLock, releaseSessionLock } from '$lib/server/sessionLock';
import { persistLog } from '$lib/server/services/persistentLogger';

export const POST: RequestHandler = async ({ request, platform }) => {
  let runId: string | null = null;

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
    runId = run.id;

    // 세션 잠금 획득 시도
    const lockResult = await acquireSessionLock(run.id);
    if (!lockResult.success) {
      await persistLog('WARN', 'API', 'Session lock denied - another run in progress', {
        newRunId: run.id,
        blockedByRunId: lockResult.currentRunId
      });
      return json({
        error: '현재 다른 분석이 진행 중입니다. 완료될 때까지 기다려 주세요.',
        currentRunId: lockResult.currentRunId,
        status: 'BUSY'
      }, { status: 423 }); // 423 Locked
    }

    await persistLog('INFO', 'API', 'New run created with session lock', { runId: run.id, mode });

    // [FIX] Trigger execution immediately on the same instance to avoid Vercel FS isolation issues
    console.log(`[API] Triggering execution for run ${run.id} with mode: ${run.execution_mode || 'MULTI_AGENT (default)'}`);

    const executionPromise = executeRun(run.id, run.execution_mode)
      .catch(err => {
        console.error(`[API] Background execution error for run ${run.id}:`, err);
      })
      .finally(() => {
        // 실행 완료 시 잠금 해제
        releaseSessionLock(run.id).catch(e => console.error('[API] Failed to release lock:', e));
      });

    if ((platform as any)?.waitUntil) {
      console.log(`[API] Using platform.waitUntil for run ${run.id}`);
      (platform as any).waitUntil(executionPromise);
    } else {
      const allowAsync = process.env.NODE_ENV === 'development' || process.env.USE_SUPABASE === 'true';
      if (allowAsync) {
        console.warn(`[API] platform.waitUntil not available; running in background for run ${run.id}`);
      } else {
        console.warn(`[API] platform.waitUntil not available, executing synchronously for run ${run.id}`);
        await executionPromise;
      }
    }

    return json({
      runId: run.id,
      message: `${filePaths.length}개 파일 업로드 완료`,
      mode: run.execution_mode,
      debug: {
        hasWaitUntil: !!((platform as any)?.waitUntil),
        executionMode: run.execution_mode,
        modeFromForm: mode,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    // 에러 시 잠금 해제
    if (runId) {
      await releaseSessionLock(runId).catch(() => { });
    }
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
