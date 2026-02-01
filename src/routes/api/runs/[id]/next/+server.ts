/** File: src/routes/api/runs/[id]/next/+server.ts */
/**
 * POST /api/runs/[id]/next - Execute next stage for a run (Step-by-Step mode)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { executeNextStep } from '$lib/server/orchestrator';

export const POST: RequestHandler = async ({ params }) => {
    const { id } = params;

    try {
        console.log(`[API] POST /api/runs/${id}/next - Executing next step`);

        const result = await executeNextStep(id);

        console.log(`[API] Next step result:`, result);
        return json(result);

    } catch (error) {
        console.error(`[API] POST /api/runs/${id}/next error:`, error);
        return json({
            status: 'error',
            message: error instanceof Error ? error.message : 'Internal server error'
        }, { status: 500 });
    }
};
