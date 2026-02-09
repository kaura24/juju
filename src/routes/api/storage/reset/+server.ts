/** File: src/routes/api/storage/reset/+server.ts */
/**
 * POST /api/storage/reset - 저장소 전체 초기화
 * - 모든 Run 데이터 삭제
 * - Supabase Storage의 모든 이미지 삭제
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearAllRuns } from '$lib/server/storage';
import { persistLog } from '$lib/server/services/persistentLogger';

export const POST: RequestHandler = async () => {
    await persistLog('INFO', 'StorageReset', 'Storage reset requested', {
        env: {
            VERCEL: process.env.VERCEL,
            USE_SUPABASE: process.env.USE_SUPABASE,
            NODE_ENV: process.env.NODE_ENV
        }
    });

    try {
        console.log('[API] Storage reset requested');

        // 1. 모든 Run 데이터 삭제
        const result = await clearAllRuns();

        await persistLog('INFO', 'StorageReset', 'Storage reset completed', result);
        console.log(`[API] Storage reset completed: ${result.deletedRuns} runs, ${result.deletedFiles} files deleted`);

        return json({
            success: true,
            message: '저장소가 초기화되었습니다',
            deletedRuns: result.deletedRuns,
            deletedFiles: result.deletedFiles
        });

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Storage reset failed';
        await persistLog('ERROR', 'StorageReset', 'Storage reset failed', { error: errorMsg });
        console.error('[API] Storage reset error:', error);
        return json({
            error: errorMsg
        }, { status: 500 });
    }
};

