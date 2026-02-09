/** File: src/routes/api/storage/reset/+server.ts */
/**
 * POST /api/storage/reset - 저장소 전체 초기화
 * - 모든 Run 데이터 삭제
 * - Supabase Storage의 모든 이미지 삭제
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearAllRuns } from '$lib/server/storage';

export const POST: RequestHandler = async () => {
    try {
        console.log('[API] Storage reset requested');

        // 1. 모든 Run 데이터 삭제
        const result = await clearAllRuns();

        console.log(`[API] Storage reset completed: ${result.deletedRuns} runs, ${result.deletedFiles} files deleted`);

        return json({
            success: true,
            message: '저장소가 초기화되었습니다',
            deletedRuns: result.deletedRuns,
            deletedFiles: result.deletedFiles
        });

    } catch (error) {
        console.error('[API] Storage reset error:', error);
        return json({
            error: error instanceof Error ? error.message : 'Storage reset failed'
        }, { status: 500 });
    }
};
