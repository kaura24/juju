/**
 * GET /api/runs/:id/events - SSE 이벤트 스트림
 */

import type { RequestHandler } from './$types';
import { getRun, getStageEvents } from '$lib/server/storage';
import { createSSEStream, formatSSEMessage } from '$lib/server/events';
import { MODEL, FAST_MODEL } from '$lib/server/agents';
import type { SSEMessage } from '$lib/types';

export const config = {
  maxDuration: 60
};

export const GET: RequestHandler = async ({ params }) => {
  const runId = params.id;

  // Run 존재 확인
  const run = await getRun(runId);
  if (!run) {
    return new Response(JSON.stringify({ error: 'Run not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 기존 이벤트들을 먼저 전송하고 새 이벤트 구독
  const encoder = new TextEncoder();
  const existingEvents = await getStageEvents(runId);

  const stream = new ReadableStream({
    async start(controller) {
      // 연결 확인 메시지
      const resolvedModel = run.execution_mode === 'FAST' ? FAST_MODEL : MODEL;
      const connectMessage: SSEMessage = {
        type: 'completed',
        payload: { message: `Connected to event stream. AI Model: ${resolvedModel}` },
        timestamp: new Date().toISOString()
      };
      controller.enqueue(encoder.encode(formatSSEMessage(connectMessage)));

      // 기존 이벤트 전송
      for (const event of existingEvents) {
        const message: SSEMessage = {
          type: 'stage_event',
          payload: event,
          timestamp: event.timestamp
        };
        controller.enqueue(encoder.encode(formatSSEMessage(message)));
      }

      // 이미 완료된 Run인 경우
      if (run.status === 'completed' || run.status === 'rejected' || run.status === 'error') {
        const statusMessage: SSEMessage = {
          type: run.status === 'completed' ? 'completed' : 'error',
          payload: { message: `Run ${run.status}` },
          timestamp: new Date().toISOString()
        };
        controller.enqueue(encoder.encode(formatSSEMessage(statusMessage)));
        controller.close();
        return;
      }

      // 새 이벤트 구독
      const { subscribeToRun } = await import('$lib/server/events');
      const cleanup = subscribeToRun(runId, (message) => {
        try {
          controller.enqueue(encoder.encode(formatSSEMessage(message)));

          // 완료/에러 시 스트림 종료
          if (message.type === 'completed' || message.type === 'error') {
            setTimeout(() => {
              try {
                controller.close();
              } catch {
                // 이미 닫힌 경우 무시
              }
            }, 100);
          }
        } catch {
          // 스트림이 닫힌 경우 무시
        }
      });

      // 취소 시 정리는 cancel()에서 처리
      (controller as unknown as { cleanup?: () => void }).cleanup = cleanup;
    },
    cancel(controller) {
      const ctrl = controller as unknown as { cleanup?: () => void };
      if (ctrl.cleanup) {
        ctrl.cleanup();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
};
