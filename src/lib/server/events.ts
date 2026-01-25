/** File: src/lib/server/events.ts */
/**
 * SSE 이벤트 관리 모듈
 * - Run별 이벤트 스트림 관리
 * - StageEvent, FinalAnswer, HITL, Error, AgentLog 이벤트 발송
 */

import type { StageEvent, InsightsAnswerSet, HITLPacket, SSEMessage } from '$lib/types';
import type { OrchestratorSummary } from './agentLogger';
import { MODEL } from './agents';

// ============================================
// 이벤트 리스너 관리
// ============================================

type EventHandler = (message: SSEMessage) => void;

const eventListeners: Map<string, Set<EventHandler>> = new Map();

/**
 * Run에 이벤트 리스너 등록
 * @returns cleanup 함수
 */
export function subscribeToRun(runId: string, handler: EventHandler): () => void {
  if (!eventListeners.has(runId)) {
    eventListeners.set(runId, new Set());
  }

  const listeners = eventListeners.get(runId)!;
  listeners.add(handler);

  // Cleanup 함수 반환
  return () => {
    listeners.delete(handler);
    if (listeners.size === 0) {
      eventListeners.delete(runId);
    }
  };
}

/**
 * Run의 모든 리스너에게 메시지 브로드캐스트
 */
function broadcast(runId: string, message: SSEMessage): void {
  const listeners = eventListeners.get(runId);
  if (!listeners) return;

  for (const handler of listeners) {
    try {
      handler(message);
    } catch (error) {
      console.error(`[Events] Error in handler for run ${runId}:`, error);
    }
  }
}

// ============================================
// 이벤트 발송 함수
// ============================================

/**
 * StageEvent 발송
 */
export function emitStageEvent(runId: string, event: StageEvent): void {
  const message: SSEMessage = {
    type: 'stage_event',
    payload: event,
    timestamp: new Date().toISOString()
  };

  console.log(`[Events] Stage ${event.stage_name} for run ${runId}: ${event.summary}`);
  broadcast(runId, message);
}

/**
 * 최종 답변 발송
 */
export function emitFinalAnswer(runId: string, answer: InsightsAnswerSet): void {
  const message: SSEMessage = {
    type: 'final_answer',
    payload: answer,
    timestamp: new Date().toISOString()
  };

  console.log(`[Events] Final answer for run ${runId}`);
  broadcast(runId, message);
}

/**
 * HITL 필요 알림 발송
 */
export function emitHITLRequired(runId: string, packet: HITLPacket): void {
  const message: SSEMessage = {
    type: 'hitl_required',
    payload: packet,
    timestamp: new Date().toISOString()
  };

  console.log(`[Events] HITL required for run ${runId}: ${packet.required_action}`);
  broadcast(runId, message);
}

/**
 * 에러 발송
 */
export function emitError(runId: string, errorMessage: string): void {
  const message: SSEMessage = {
    type: 'error',
    payload: { message: errorMessage },
    timestamp: new Date().toISOString()
  };

  console.error(`[Events] Error for run ${runId}: ${errorMessage}`);
  broadcast(runId, message);
}

/**
 * 완료 알림 발송
 */
export function emitCompleted(runId: string): void {
  const message: SSEMessage = {
    type: 'completed',
    payload: { message: 'Run completed successfully' },
    timestamp: new Date().toISOString()
  };

  console.log(`[Events] Run ${runId} completed`);
  broadcast(runId, message);
}

/**
 * 에이전트 로그 (오케스트레이터 종합 리포트) 발송
 */
export function emitAgentLog(runId: string, summary: OrchestratorSummary): void {
  const message: SSEMessage = {
    type: 'agent_log',
    payload: summary,
    timestamp: new Date().toISOString()
  };

  console.log(`[Events] Agent log for run ${runId}: ${summary.final_status}`);
  broadcast(runId, message);
}

/**
 * 개별 로그 엔트리 실시간 발송
 */
export function emitAgentLogEntry(runId: string, entry: any): void {
  const message: SSEMessage = {
    type: 'log_entry',
    payload: entry,
    timestamp: new Date().toISOString()
  };
  broadcast(runId, message);
}

// ============================================
// SSE 스트림 생성 헬퍼
// ============================================

/**
 * SSE 메시지 포맷팅
 */
export function formatSSEMessage(message: SSEMessage): string {
  return `data: ${JSON.stringify(message)}\n\n`;
}

/**
 * SSE ReadableStream 생성
 */
export function createSSEStream(runId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      // 연결 확인 메시지
      const connectMessage: SSEMessage = {
        type: 'completed',
        payload: { message: `Connected to event stream. AI Model: ${MODEL}` },
        timestamp: new Date().toISOString()
      };
      controller.enqueue(encoder.encode(formatSSEMessage(connectMessage)));

      // 이벤트 핸들러 등록
      const cleanup = subscribeToRun(runId, (message) => {
        try {
          controller.enqueue(encoder.encode(formatSSEMessage(message)));
        } catch {
          // 스트림이 닫힌 경우 무시
        }
      });

      // 취소 시 정리
      return cleanup;
    },
    cancel() {
      console.log(`[Events] SSE stream cancelled for run ${runId}`);
    }
  });
}

// ============================================
// 유틸리티
// ============================================

/**
 * 리스너 수 조회
 */
export function getListenerCount(runId: string): number {
  return eventListeners.get(runId)?.size ?? 0;
}

/**
 * 모든 리스너 정리 (테스트용)
 */
export function clearAllListeners(): void {
  eventListeners.clear();
}
