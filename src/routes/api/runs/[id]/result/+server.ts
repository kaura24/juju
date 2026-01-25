/**
 * GET /api/runs/:id/result - 최종 결과 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun, getArtifact } from '$lib/server/storage';
import type { InsightsAnswerSet } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const runId = params.id;
    
    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }
    
    if (run.status !== 'completed') {
      return json({ 
        error: `Run is ${run.status}, not completed`,
        status: run.status
      }, { status: 400 });
    }
    
    const answerSet = await getArtifact<InsightsAnswerSet>(runId, 'INSIGHTS', 'answer_set');
    if (!answerSet) {
      return json({ error: 'Result not found' }, { status: 404 });
    }
    
    return json({
      runId,
      status: 'completed',
      result: answerSet
    });
    
  } catch (error) {
    console.error('[API] GET /api/runs/:id/result error:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
};
