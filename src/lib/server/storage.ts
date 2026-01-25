/** File: src/lib/server/storage.ts */
/**
 * 서버 사이드 스토리지 모듈
 * - 인메모리 저장소 (프로덕션에서는 DB로 교체)
 * - Run, StageEvent, Artifact, HITL 패킷 관리
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Run,
  RunStatus,
  StageEvent,
  StageName,
  HITLPacket,
  DocumentAssessment,
  ExtractorOutput,
  NormalizedDoc,
  ValidationReport,
  InsightsAnswerSet,
  ReasonCode,
  RequiredAction,
  RuleTrigger
} from '$lib/types';
import { extractHITLReasonCodes, determineRequiredAction } from '$lib/validator/ruleEngine';

// ============================================
// 인메모리 저장소
// ============================================

const runs: Map<string, Run> = new Map();
const stageEvents: Map<string, StageEvent[]> = new Map();
const artifacts: Map<string, Map<string, unknown>> = new Map();
const hitlPackets: Map<string, HITLPacket> = new Map();

// ============================================
// Run 관리
// ============================================

/**
 * 새 Run 생성
 */
export async function createRun(filePaths: string[]): Promise<Run> {
  const run: Run = {
    id: uuidv4(),
    status: 'pending',
    files: filePaths,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  runs.set(run.id, run);
  stageEvents.set(run.id, []);
  artifacts.set(run.id, new Map());

  return run;
}

/**
 * Run 조회
 */
export async function getRun(runId: string): Promise<Run | null> {
  return runs.get(runId) || null;
}

/**
 * Run 상태 업데이트
 */
export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  currentStage?: StageName,
  errorMessage?: string
): Promise<void> {
  const run = runs.get(runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.status = status;
  run.updated_at = new Date().toISOString();

  if (currentStage !== undefined) {
    run.current_stage = currentStage;
  }
  if (errorMessage !== undefined) {
    run.error_message = errorMessage;
  }
}

/**
 * 모든 Run 목록 조회
 */
export async function listRuns(): Promise<Run[]> {
  return Array.from(runs.values()).sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * 서버 재시작 시 실행 중인 모든 세션 정리
 * - running 상태의 모든 run을 error 상태로 변경
 * - 메시지: "Server restarted"
 */
export async function cleanupRunningSessions(): Promise<number> {
  let cleanedCount = 0;

  for (const run of runs.values()) {
    if (run.status === 'running') {
      run.status = 'error';
      run.error_message = 'Server restarted';
      run.updated_at = new Date().toISOString();
      cleanedCount++;
      console.log(`[Storage] Cleaned up running session: ${run.id}`);
    }
  }

  if (cleanedCount > 0) {
    console.log(`[Storage] Cleaned up ${cleanedCount} running sessions on restart`);
  }

  return cleanedCount;
}


// ============================================
// StageEvent 관리
// ============================================

/**
 * StageEvent 저장
 */
export async function saveStageEvent(runId: string, event: StageEvent): Promise<void> {
  const events = stageEvents.get(runId);
  if (!events) {
    throw new Error(`Run not found: ${runId}`);
  }
  events.push(event);
}

/**
 * Run의 모든 StageEvent 조회
 */
export async function getStageEvents(runId: string): Promise<StageEvent[]> {
  return stageEvents.get(runId) || [];
}

// ============================================
// Artifact 관리
// ============================================

type ArtifactType = 'assessment' | 'extractor_output' | 'normalized_doc' | 'validation_report' | 'answer_set';

/**
 * Artifact 저장
 */
export async function saveArtifact(
  runId: string,
  stage: string,
  type: ArtifactType,
  data: DocumentAssessment | ExtractorOutput | NormalizedDoc | ValidationReport | InsightsAnswerSet
): Promise<void> {
  const runArtifacts = artifacts.get(runId);
  if (!runArtifacts) {
    throw new Error(`Run not found: ${runId}`);
  }

  const key = `${stage}:${type}`;
  runArtifacts.set(key, data);
}

/**
 * Artifact 조회
 */
export async function getArtifact<T>(
  runId: string,
  stage: string,
  type: ArtifactType
): Promise<T | null> {
  const runArtifacts = artifacts.get(runId);
  if (!runArtifacts) {
    return null;
  }

  const key = `${stage}:${type}`;
  return (runArtifacts.get(key) as T) || null;
}

// ============================================
// HITL Packet 관리
// ============================================

/**
 * HITL 패킷 생성
 */
export async function createHITLPacket(
  runId: string,
  stage: StageName,
  payload: {
    normalized?: NormalizedDoc;
    extractor_output?: ExtractorOutput;
    assessment?: DocumentAssessment;
    triggers?: RuleTrigger[];
  },
  contextInfo?: {
    company_name: string | null;
    document_date: string | null;
    shareholder_names: string[];
  }
): Promise<HITLPacket> {
  const triggers = payload.triggers || [];
  const reasonCodes = extractHITLReasonCodes(triggers) as ReasonCode[];
  const requiredAction = determineRequiredAction(triggers) as RequiredAction;

  const packet: HITLPacket = {
    id: uuidv4(),
    doc_id: `doc_${runId}`,
    run_id: runId,
    stage,
    reason_codes: reasonCodes.length > 0 ? reasonCodes : ['MISSING_REQUIRED_FIELD_OR_PARSE_FAILURE'],
    required_action: requiredAction,
    triggers,
    operator_notes: triggers
      .filter(t => t.severity === 'BLOCKER')
      .map(t => t.message),
    payload: {
      normalized: payload.normalized,
      extractor_output: payload.extractor_output,
      assessment: payload.assessment
    },
    context_info: contextInfo || {
      company_name: payload.normalized?.document_properties.company_name
        || payload.extractor_output?.document_info.company_name
        || null,
      document_date: payload.normalized?.document_properties.document_date
        || payload.extractor_output?.document_info.document_date
        || null,
      shareholder_names: payload.normalized?.shareholders.map(s => s.name || 'Unknown')
        || payload.extractor_output?.records.map(r => r.raw_name || 'Unknown')
        || []
    },
    created_at: new Date().toISOString()
  };

  hitlPackets.set(packet.id, packet);
  return packet;
}

/**
 * HITL 패킷 조회
 */
export async function getHITLPacket(packetId: string): Promise<HITLPacket | null> {
  return hitlPackets.get(packetId) || null;
}

/**
 * Run에 연결된 HITL 패킷 조회
 */
export async function getHITLPacketByRunId(runId: string): Promise<HITLPacket | null> {
  for (const packet of hitlPackets.values()) {
    if (packet.run_id === runId && !packet.resolved_at) {
      return packet;
    }
  }
  return null;
}

/**
 * HITL 패킷 해결
 */
export async function resolveHITLPacket(
  packetId: string,
  resolution: {
    action_taken: string;
    resolved_by: string;
    corrections?: Record<string, unknown>;
  }
): Promise<void> {
  const packet = hitlPackets.get(packetId);
  if (!packet) {
    throw new Error(`HITL packet not found: ${packetId}`);
  }

  packet.resolved_at = new Date().toISOString();
  packet.resolution = resolution;
}

/**
 * 대기 중인 HITL 패킷 목록 조회
 */
export async function listPendingHITLPackets(): Promise<HITLPacket[]> {
  return Array.from(hitlPackets.values())
    .filter(p => !p.resolved_at)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// ============================================
// 파일 저장
// ============================================

import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import os from 'os';

const UPLOAD_DIR = join(os.tmpdir(), 'juju-uploads');
const LOG_DIR = join(os.tmpdir(), 'juju-logs');

/**
 * 업로드된 파일 저장
 */
export async function saveFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${uuidv4()}_${file.name}`;
  const filepath = join(UPLOAD_DIR, filename);

  // 디렉토리 생성
  await mkdir(dirname(filepath), { recursive: true });

  // 파일 저장
  await writeFile(filepath, buffer);

  return filepath;
}

/**
 * Base64 이미지로 파일 저장
 */
export async function saveBase64Image(base64Data: string, mimeType: string): Promise<string> {
  const extension = mimeType.split('/')[1] || 'png';
  const filename = `${uuidv4()}.${extension}`;
  const filepath = join(UPLOAD_DIR, filename);

  // data:image/png;base64, 접두사 제거
  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  await mkdir(dirname(filepath), { recursive: true });
  await writeFile(filepath, buffer);

  return filepath;
}

// ============================================
// 유틸리티
// ============================================

// ============================================
// 로그 스토리지 (파일 기반)
// ============================================

import type { RunLogReport } from './agentLogger';

// LOG_DIR is already defined above

/**
 * 실행 로그 저장 (파일에 쓰기)
 */
export async function saveRunLog(log: RunLogReport): Promise<void> {
  const filepath = join(LOG_DIR, `${log.run_id}.json`);

  try {
    await mkdir(dirname(filepath), { recursive: true });
    await writeFile(filepath, JSON.stringify(log, null, 2));
  } catch (error) {
    console.error(`Failed to save run log ${log.run_id}:`, error);
  }
}

/**
 * 실행 로그 로드 (파일에서 읽기)
 */
export async function loadRunLog(runId: string): Promise<RunLogReport | null> {
  const filepath = join(LOG_DIR, `${runId}.json`);

  try {
    const data = await readFile(filepath, 'utf-8');
    return JSON.parse(data) as RunLogReport;
  } catch (error) {
    // 파일이 없으면 null 반환 (아직 생성 안됨)
    return null;
  }
}
