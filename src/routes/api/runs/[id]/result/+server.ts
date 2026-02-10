/**
 * GET /api/runs/:id/result - 최종 결과 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun, getArtifact } from '$lib/server/storage';
import type { InsightsAnswerSet, DocumentAssessment } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const runId = params.id;
    
    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }
    
    if (run.status === 'rejected') {
      const assessment = await getArtifact<DocumentAssessment>(runId, 'B', 'assessment');
      return json({
        runId,
        status: 'rejected',
        reason: assessment
          ? {
              is_shareholder_register: assessment.is_shareholder_register,
              has_required_info: assessment.has_required_info,
              detected_document_type: assessment.detected_document_type,
              detected_ownership_basis: assessment.detected_ownership_basis,
              document_info: assessment.document_info,
              required_fields_present: assessment.required_fields_present,
              rationale: assessment.rationale,
              route_suggestion: assessment.route_suggestion,
              evidence_refs: assessment.evidence_refs
            }
          : {
              message: run.error || 'Rejected without assessment',
            }
      }, { status: 200 });
    }

    if (run.status !== 'completed') {
      return json({
        error: `Run is ${run.status}, not completed`,
        status: run.status
      }, { status: 400 });
    }
    
    const preferredStage = run.execution_mode === 'FAST' ? 'FAST' : 'INSIGHTS';
    let answerSet = await getArtifact<InsightsAnswerSet>(runId, preferredStage as any, 'answer_set');
    if (!answerSet && preferredStage !== 'INSIGHTS') {
      // Fallback for legacy or mixed-mode runs
      answerSet = await getArtifact<InsightsAnswerSet>(runId, 'INSIGHTS', 'answer_set');
    }
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
