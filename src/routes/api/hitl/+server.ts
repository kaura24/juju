/**
 * GET /api/hitl - 대기 중인 HITL 목록 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPendingHITLPackets } from '$lib/server/storage';

export const GET: RequestHandler = async () => {
  try {
    const packets = await listPendingHITLPackets();
    
    return json({
      count: packets.length,
      packets: packets.map(p => ({
        id: p.id,
        runId: p.run_id,
        stage: p.stage,
        reasonCodes: p.reason_codes,
        requiredAction: p.required_action,
        operatorNotes: p.operator_notes,
        createdAt: p.created_at
      }))
    });
    
  } catch (error) {
    console.error('[API] GET /api/hitl error:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
};
