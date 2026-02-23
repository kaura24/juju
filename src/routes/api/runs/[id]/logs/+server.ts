
import { json } from '@sveltejs/kit';
import { getRunLog } from '$lib/server/agentLogger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

  // 1. Try in-memory or standard path
  let logs = await getRunLog(id);

  // 2. If not found, try reading directly from the local disk fallback
  if (!logs) {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const logPath = path.join(process.cwd(), 'logs', `${id}.json`);
      const data = await fs.readFile(logPath, 'utf-8');
      logs = JSON.parse(data);
    } catch (err) {
      console.warn(`[API Logs] Local fallback read failed for ${id}:`, err);
    }
  }

  if (!logs) {
    return new Response(null, { status: 404 });
  }

  return json({ data: logs });
};
