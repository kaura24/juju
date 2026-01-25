/**
 * POST /api/runs/:id/execute - Run 실행 시작
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun } from '$lib/server/storage';
import { executeRun } from '$lib/server/orchestrator';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const runId = params.id;

    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    if (run.status !== 'pending') {
      return json({
        error: `Run is already ${run.status}`,
        success: false
      }, { status: 400 });
    }

    const { mode } = await request.json().catch(() => ({ mode: undefined }));

    // 백그라운드에서 실행 (즉시 응답)
    executeRun(runId, mode).catch(error => {
      console.error(`[API] Background execution error for run ${runId}:`, error);
    });

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
