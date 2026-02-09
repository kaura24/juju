/** File: src/routes/api/debug/logs/+server.ts */
/**
 * GET /api/debug/logs - 저장된 디버그 로그 조회
 * POST /api/debug/logs - 로그 추가 (테스트용)
 * DELETE /api/debug/logs - 모든 로그 삭제
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { persistLog, getRecentLogs, clearDebugLogs } from '$lib/server/services/persistentLogger';

export const GET: RequestHandler = async ({ url }) => {
    const limit = parseInt(url.searchParams.get('limit') || '50');

    // 시스템 상태도 함께 로깅
    await persistLog('INFO', 'API', 'Debug logs requested', {
        limit,
        env: {
            VERCEL: process.env.VERCEL,
            USE_SUPABASE: process.env.USE_SUPABASE,
            NODE_ENV: process.env.NODE_ENV
        }
    });

    const logs = await getRecentLogs(limit);

    return json({
        success: true,
        count: logs.length,
        logs
    });
};

export const POST: RequestHandler = async ({ request }) => {
    try {
        const body = await request.json();
        const { level = 'INFO', source = 'Manual', message = 'Test log', data } = body;

        await persistLog(level, source, message, data);

        return json({ success: true, message: 'Log saved' });
    } catch (e) {
        return json({ error: 'Failed to save log' }, { status: 500 });
    }
};

export const DELETE: RequestHandler = async () => {
    const deleted = await clearDebugLogs();
    return json({ success: true, deleted });
};
