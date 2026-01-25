/** File: src/lib/server/agentLogger.ts */
/**
 * Agent 로그 시스템
 * - 각 에이전트별 실행 로그 기록
 * - 인간이 이해할 수 있는 형식으로 결과 제공
 * - 오케스트레이터 종합 리포트 생성
 */

export type AgentName = 'Orchestrator' | 'B_Gatekeeper' | 'C_Extractor' | 'D_Normalizer' | 'E_Validator' | 'INS_Analyst' | 'FastExtractor';

// ... (omitting intermediate lines, wait, replace_file_content needs contiguous block)
// I will do two separate replaces if needed OR one large block if close enough. 
// They are far apart (line 8 vs line 340). I'll use multi_replace or two calls.
// Since 'multi_replace' is available, I should check if I can use it. Yes.
// But `replace_file_content` rule says "To edit multiple, non-adjacent lines... make a single call to the multi_replace_file_content tool".
// So I will use `multi_replace_file_content`.

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR' | 'DEBUG';

/**
 * 개별 로그 엔트리
 */
export interface AgentLogEntry {
  timestamp: string;
  agent: AgentName;
  level: LogLevel;
  action: string;        // 수행한 작업
  detail: string;        // 상세 설명
  data?: unknown;        // 관련 데이터 (선택)
  duration_ms?: number;  // 소요 시간
}

/**
 * 에이전트별 로그 컬렉션
 */
export interface AgentLogCollection {
  agent: AgentName;
  logs: AgentLogEntry[];
  start_time: string;
  end_time?: string;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'PENDING';
  summary?: string;
}

/**
 * 전체 실행 로그
 */
export interface RunLogReport {
  run_id: string;
  start_time: string;
  end_time?: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'HITL_REQUIRED' | 'CANCELLED';
  agents: AgentLogCollection[];
  orchestrator_summary?: OrchestratorSummary;
}

/**
 * 오케스트레이터 종합 리포트
 */
export interface OrchestratorSummary {
  total_duration_ms: number;
  stages_completed: string[];
  stages_skipped: string[];
  final_status: string;
  key_findings: string[];
  warnings: string[];
  errors: string[];
  hitl_reasons?: string[];
  next_steps?: string[];
}

// ============================================
// 로그 저장소 (In-Memory)
// ============================================
import { saveRunLog, loadRunLog } from './storage';

// In-Memory cache (still useful for speed, but synced to disk)
const runLogs = new Map<string, RunLogReport>();

/**
 * 새 실행 로그 초기화
 */
export async function initRunLog(runId: string): Promise<RunLogReport> {
  const report: RunLogReport = {
    run_id: runId,
    start_time: new Date().toISOString(),
    status: 'RUNNING',
    agents: []
  };
  runLogs.set(runId, report);
  await saveRunLog(report);
  return report;
}

/**
 * 에이전트 로그 컬렉션 시작
 */
export async function startAgentLog(runId: string, agent: AgentName): Promise<AgentLogCollection> {
  const report = runLogs.get(runId);
  if (!report) {
    throw new Error(`Run ${runId} not found`);
  }

  const collection: AgentLogCollection = {
    agent,
    logs: [],
    start_time: new Date().toISOString(),
    status: 'RUNNING'
  };

  report.agents.push(collection);
  await saveRunLog(report);
  return collection;
}

/**
 * 에이전트 로그 추가
 */
import { emitAgentLogEntry } from './events';

export async function addAgentLog(
  runId: string,
  agent: AgentName,
  level: LogLevel,
  action: string,
  detail: string,
  data?: unknown,
  duration_ms?: number
): Promise<void> {
  const report = runLogs.get(runId);
  if (!report) return;

  const collection = report.agents.find(a => a.agent === agent && a.status === 'RUNNING');
  if (!collection) return;

  const entry: AgentLogEntry = {
    timestamp: new Date().toISOString(),
    agent,
    level,
    action,
    detail,
    data,
    duration_ms
  };

  collection.logs.push(entry);

  // Emit real-time event
  emitAgentLogEntry(runId, entry);

  // 비동기 저장 (await 안함 - 성능 향상)
  saveRunLog(report).catch(e => console.error('Log save failed', e));
}

/**
 * 에이전트 로그 완료
 */
export async function completeAgentLog(
  runId: string,
  agent: AgentName,
  status: 'SUCCESS' | 'FAILED',
  summary: string
): Promise<void> {
  const report = runLogs.get(runId);
  if (!report) return;

  const collection = report.agents.find(a => a.agent === agent && a.status === 'RUNNING');
  if (!collection) return;

  collection.end_time = new Date().toISOString();
  collection.status = status;
  collection.summary = summary;
  await saveRunLog(report);
}

/**
 * 실행 로그 완료
 */
export async function completeRunLog(
  runId: string,
  status: RunLogReport['status'],
  summary: OrchestratorSummary
): Promise<void> {
  const report = runLogs.get(runId);
  if (!report) return;

  report.end_time = new Date().toISOString();
  report.status = status;
  report.orchestrator_summary = summary;
  await saveRunLog(report);
}

/**
 * 실행 로그 조회
 */
export async function getRunLog(runId: string): Promise<RunLogReport | undefined> {
  const cached = runLogs.get(runId);
  if (cached) return cached;

  const loaded = await loadRunLog(runId);
  if (loaded) {
    runLogs.set(runId, loaded);
    return loaded;
  }
  return undefined;
}

/**
 * 에이전트별 로그 조회
 */
export function getAgentLogs(runId: string, agent: AgentName): AgentLogCollection | undefined {
  const report = runLogs.get(runId);
  if (!report) return undefined;

  return report.agents.find(a => a.agent === agent);
}

/**
 * 전체 로그를 인간이 읽기 쉬운 형식으로 포맷
 */
export function formatRunLogForHuman(runId: string): string {
  const report = runLogs.get(runId);
  if (!report) return `실행 로그 ${runId}를 찾을 수 없습니다.`;

  let output = '';
  output += `\n${'='.repeat(60)}\n`;
  output += `📋 실행 보고서: ${runId}\n`;
  output += `${'='.repeat(60)}\n\n`;

  output += `⏰ 시작: ${formatTimestamp(report.start_time)}\n`;
  if (report.end_time) {
    output += `⏰ 완료: ${formatTimestamp(report.end_time)}\n`;
  }
  output += `📊 상태: ${formatStatus(report.status)}\n\n`;

  // 각 에이전트 로그
  for (const agentLog of report.agents) {
    output += `${'─'.repeat(50)}\n`;
    output += `🤖 ${getAgentDisplayName(agentLog.agent)}\n`;
    output += `${'─'.repeat(50)}\n`;
    output += `상태: ${formatStatus(agentLog.status)}\n`;

    if (agentLog.summary) {
      output += `요약: ${agentLog.summary}\n`;
    }

    output += `\n수행 내역:\n`;
    for (const log of agentLog.logs) {
      const icon = getLogIcon(log.level);
      output += `  ${icon} [${formatTime(log.timestamp)}] ${log.action}\n`;
      output += `     └─ ${log.detail}\n`;
      if (log.duration_ms) {
        output += `     └─ ⏱️ ${log.duration_ms}ms\n`;
      }
    }
    output += '\n';
  }

  // 오케스트레이터 종합 리포트
  if (report.orchestrator_summary) {
    const summary = report.orchestrator_summary;
    output += `${'='.repeat(60)}\n`;
    output += `📊 종합 분석 결과\n`;
    output += `${'='.repeat(60)}\n\n`;

    output += `⏱️ 총 소요 시간: ${(summary.total_duration_ms / 1000).toFixed(2)}초\n`;
    output += `✅ 완료된 단계: ${summary.stages_completed.join(' → ') || '없음'}\n`;

    if (summary.stages_skipped.length > 0) {
      output += `⏭️ 스킵된 단계: ${summary.stages_skipped.join(', ')}\n`;
    }

    output += `\n🔍 주요 발견사항:\n`;
    for (const finding of summary.key_findings) {
      output += `  • ${finding}\n`;
    }

    if (summary.warnings.length > 0) {
      output += `\n⚠️ 경고:\n`;
      for (const warning of summary.warnings) {
        output += `  • ${warning}\n`;
      }
    }

    if (summary.errors.length > 0) {
      output += `\n❌ 오류:\n`;
      for (const error of summary.errors) {
        output += `  • ${error}\n`;
      }
    }

    if (summary.hitl_reasons && summary.hitl_reasons.length > 0) {
      output += `\n👤 사람 검토 필요 사유:\n`;
      for (const reason of summary.hitl_reasons) {
        output += `  • ${reason}\n`;
      }
    }

    if (summary.next_steps && summary.next_steps.length > 0) {
      output += `\n➡️ 다음 단계:\n`;
      for (const step of summary.next_steps) {
        output += `  • ${step}\n`;
      }
    }
  }

  return output;
}

// ============================================
// 헬퍼 함수들
// ============================================

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'RUNNING': '🔄 실행 중',
    'SUCCESS': '✅ 성공',
    'FAILED': '❌ 실패',
    'PENDING': '⏳ 대기 중',
    'COMPLETED': '✅ 완료',
    'HITL_REQUIRED': '👤 사람 검토 필요'
  };
  return statusMap[status] || status;
}

function getAgentDisplayName(agent: AgentName): string {
  const names: Record<AgentName, string> = {
    'Orchestrator': '오케스트레이터 (총괄 관리자)',
    'B_Gatekeeper': 'B단계: 게이트키퍼 (문서 분류)',
    'C_Extractor': 'C단계: 추출기 (데이터 추출)',
    'D_Normalizer': 'D단계: 정규화기 (데이터 변환)',
    'E_Validator': 'E단계: 검증기 (정합성 검증)',
    'INS_Analyst': 'INSIGHTS: 분석가 (최종 분석)',
    'FastExtractor': 'Fast Track: 통합 추출기'
  };
  return names[agent] || agent;
}

function getLogIcon(level: LogLevel): string {
  const icons: Record<LogLevel, string> = {
    'INFO': 'ℹ️',
    'SUCCESS': '✅',
    'WARNING': '⚠️',
    'ERROR': '❌',
    'DEBUG': '🔧'
  };
  return icons[level] || '•';
}

/**
 * 실행 로그를 JSON 형태로 내보내기 (API용)
 */
export function exportRunLogAsJSON(runId: string): RunLogReport | null {
  return runLogs.get(runId) || null;
}

/**
 * 모든 실행 로그 ID 조회
 */
export function getAllRunLogIds(): string[] {
  return Array.from(runLogs.keys());
}

/**
 * 실행 로그 삭제
 */
export function deleteRunLog(runId: string): boolean {
  return runLogs.delete(runId);
}
