
import { json } from '@sveltejs/kit';
import { loadEnvConfig } from '$lib/util/env';
import { MODEL, FALLBACK_MODEL } from '$lib/server/agents';

export function GET() {
    try {
        const config = loadEnvConfig();
        const isMock = config.MOCK_LLM;
        // Check if key looks valid (starts with sk-)
        const hasKey = !!config.OPENAI_API_KEY && config.OPENAI_API_KEY.length > 10;

        // Determine status
        let status = 'disconnected';
        if (isMock) {
            status = 'mock';
        } else if (hasKey) {
            status = 'connected';
        }

        return json({
            status,
            model: config.OPENAI_MODEL || MODEL,
            fallbackModel: FALLBACK_MODEL,
            provider: 'OpenAI'
        });
    } catch (error) {
        console.error('System status check failed:', error);
        return json({
            status: 'error',
            model: 'unknown',
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
