/**
 * POST /api/runs/:id/hitl/resolve - HITL 해결 및 Run 재개
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRun, getHITLPacketByRunId, resolveHITLPacket } from '$lib/server/storage';
import { resumeRunAfterHITL } from '$lib/server/orchestrator';
import type { HITLResolveRequest } from '$lib/types';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const runId = params.id;
    
    const run = await getRun(runId);
    if (!run) {
      return json({ error: 'Run not found' }, { status: 404 });
    }
    
    if (run.status !== 'hitl') {
      return json({ 
        error: `Run is ${run.status}, not in HITL status`,
        success: false,
        resumed: false
      }, { status: 400 });
    }
    
    // HITL 패킷 조회
    const packet = await getHITLPacketByRunId(runId);
    if (!packet) {
      return json({ 
        error: 'HITL packet not found',
        success: false,
        resumed: false
      }, { status: 404 });
    }
    
    // 요청 본문 파싱
    const body = await request.json() as HITLResolveRequest;
    
    if (!body.action_taken || !body.resolved_by) {
      return json({ 
        error: 'action_taken and resolved_by are required',
        success: false,
        resumed: false
      }, { status: 400 });
    }
    
    // HITL 패킷 해결
    await resolveHITLPacket(packet.id, {
      action_taken: body.action_taken,
      resolved_by: body.resolved_by,
      corrections: body.corrections
    });
    
    // Run 재개 (백그라운드)
    resumeRunAfterHITL(runId, body.corrections).catch(error => {
      console.error(`[API] Resume error for run ${runId}:`, error);
    });
    
    return json({
      success: true,
      resumed: true,
      message: 'HITL resolved and run resumed'
    });
    
  } catch (error) {
    console.error('[API] POST /api/runs/:id/hitl/resolve error:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Internal server error',
      success: false,
      resumed: false
    }, { status: 500 });
  }
};
