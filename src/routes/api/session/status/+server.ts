/** File: src/routes/api/session/status/+server.ts */
/**
 * GET /api/session/status - 현재 세션 잠금 상태 조회
 * DELETE /api/session/status - 강제 잠금 해제
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSessionLock, forceReleaseLock } from '$lib/server/sessionLock';

export const GET: RequestHandler = async () => {
    const lock = await getSessionLock();
    return json(lock);
};

export const DELETE: RequestHandler = async () => {
    await forceReleaseLock();
    return json({ success: true, message: 'Lock released' });
};
