/**
 * POST /api/runs/:id/execute - Run 실행 시작
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun } from '$lib/server/storage';
import { executeRun } from '$lib/server/orchestrator';

export const config = {
  maxDuration: 60
};

export const POST: RequestHandler = async ({ params, request, platform }) => {
  try {
    const runId = params.id;

    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status === 'running') {
      return json({
        error: '이미 분석이 진행 중입니다.',
        success: false
      }, { status: 400 });
    }

    if (run.status === 'completed') {
      return json({
        error: '이미 분석이 완료된 항목입니다.',
        success: false
      }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    console.log(`[API-DEBUG] EXECUTE Request for runId=${runId}, Body:`, JSON.stringify(body));

    // 1. 바디에서 모드 추출, 없으면 저장된 값 사용, 둘 다 없으면 기본값(MULTI_AGENT)
    const mode = body.mode || run.execution_mode || 'MULTI_AGENT';
    console.log(`[API-DEBUG] Selected mode for run ${runId}: ${mode} (from Body: ${body.mode}, from Run: ${run.execution_mode})`);

    // 백그라운드에서 실행 (즉시 응답)
    console.log(`[API-EXECUTE] Triggering execution for run ${runId} with mode ${mode}`);
    const executionPromise = executeRun(runId, mode).catch(error => {
      console.error(`[API-EXECUTE] Background execution error for run ${runId}:`, error);
    });

    // Vercel에서 백그라운드 프로세스가 죽지 않도록 대기 요청
    if ((platform as any)?.waitUntil) {
      console.log(`[API-EXECUTE] Using platform.waitUntil for run ${runId}`);
      (platform as any).waitUntil(executionPromise);
    } else {
      console.warn(`[API-EXECUTE] platform.waitUntil not available for run ${runId}, execution may be terminated early`);
    }

    return json({
      success: true,
      message: '분석이 시작되었습니다',
      runId
    });

  } catch (error) {
    console.error('[API] POST /api/runs/:id/execute error:', error);
    return json({
      error: error instanceof Error ? error.message : 'Internal server error',
      success: false
    }, { status: 500 });
  }
};
