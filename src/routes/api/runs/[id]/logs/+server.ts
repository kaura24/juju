
import { json } from '@sveltejs/kit';
import { getRunLog } from '$lib/server/agentLogger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
  const { id } = params;

  // getRunLog now supports async loading from disk
  const logs = await getRunLog(id);

  if (!logs) {
    return new Response(null, { status: 404 });
  }

  return json({ data: logs });
};
