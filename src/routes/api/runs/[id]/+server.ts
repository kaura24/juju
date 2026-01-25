/**
 * GET /api/runs/:id - Run 상세 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun, getStageEvents, getHITLPacketByRunId } from '$lib/server/storage';
import { MODEL } from '$lib/server/agents';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const runId = params.id;

    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }

    const events = await getStageEvents(runId);
    const hitlPacket = await getHITLPacketByRunId(runId);

    return json({
      run: {
        id: run.id,
        status: run.status,
        fileCount: run.files.length,
        currentStage: run.current_stage,
        errorMessage: run.error_message,
        createdAt: run.created_at,
        updatedAt: run.updated_at,
        model: MODEL
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
