import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateRunStatus } from '$lib/server/storage';
import { cancelRun } from '$lib/server/orchestrator';

/**
 * POST /api/runs/[id]/cancel
 * Force stop a running analysis session
 */
export const POST: RequestHandler = async ({ params }) => {
    const { id } = params;

    try {
        console.log(`[API] Force stop requested for run: ${id}`);

        // Cancel the run in orchestrator
        cancelRun(id);

        // Update run status to cancelled
        await updateRunStatus(id, 'error');

        return json({
            success: true,
            message: 'Run cancelled successfully'
        });
    } catch (error) {
        console.error('[API] Error stopping run:', error);
        return json(
            {
                success: false,
                error: 'Failed to stop run'
            },
            { status: 500 }
        );
    }
};
