/**
 * GET /api/hitl/:id - HITL 패킷 상세 조회
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getHITLPacket } from '$lib/server/storage';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const packetId = params.id;
    
    const packet = await getHITLPacket(packetId);
    if (!packet) {
      return json({ error: 'HITL packet not found' }, { status: 404 });
    }
    
    return json({
      packet
    });
    
  } catch (error) {
    console.error('[API] GET /api/hitl/:id error:', error);
    return json({ 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }, { status: 500 });
  }
};
