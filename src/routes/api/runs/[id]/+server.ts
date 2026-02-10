/**
 * GET /api/runs/:id - Run 상세 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun, getStageEvents, getHITLPacketByRunId, getArtifact, updateRunStatus } from '$lib/server/storage';
import { MODEL, FAST_MODEL } from '$lib/server/agents';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const runId = params.id;

    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const events = await getStageEvents(runId);
    const hitlPacket = await getHITLPacketByRunId(runId);

    // Self-heal: if results exist but status is still running/pending, finalize
    if (run.status === 'running' || run.status === 'pending' || run.status === 'queued') {
      const fastAnswer = await getArtifact(runId, 'FAST', 'answer_set');
      const insightsAnswer = await getArtifact(runId, 'INSIGHTS', 'answer_set');
      if (fastAnswer || insightsAnswer) {
        await updateRunStatus(runId, 'completed', run.current_stage);
        run.status = 'completed';
      }
    }

    const resolvedModel = run.execution_mode === 'FAST' ? FAST_MODEL : MODEL;

    return json({
      run: {
        id: run.id,
        status: run.status,
        fileCount: run.files.length,
        currentStage: run.current_stage,
        errorMessage: run.error_message,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        model: resolvedModel,
        storageProvider: run.storage_provider
      },
      events,
      hitlPacket: hitlPacket || null
    });

  } catch (error) {
    console.error('[API] GET /api/runs/:id error:', error);
    return json({
      error: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
};
