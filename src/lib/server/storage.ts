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

// ============================================
// 인메모리 저장소 & 파일DB 경로 설정
// ============================================

import { writeFile, mkdir, readFile, readdir, unlink, rename } from 'fs/promises';
import { join, dirname } from 'path';
import os from 'os';

const DATA_DIR = join(process.cwd(), 'data');
const UPLOAD_DIR = join(process.cwd(), 'uploads');
const LOG_DIR = join(process.cwd(), 'logs');

// 디렉토리 구조
const DIRS = {
  runs: join(DATA_DIR, 'runs'),
  events: join(DATA_DIR, 'events'),
  artifacts: join(DATA_DIR, 'artifacts'),
  hitl: join(DATA_DIR, 'hitl')
};

// 초기화 플래그
let isDirsInitialized = false;

async function ensureDirs() {
  if (isDirsInitialized) return;
  await mkdir(UPLOAD_DIR, { recursive: true });
  await mkdir(LOG_DIR, { recursive: true });
  for (const dir of Object.values(DIRS)) {
    await mkdir(dir, { recursive: true });
  }
  isDirsInitialized = true;
}

// 헬퍼: 파일 기반 저장/로드 (Idempotency 강화: Atomic Write)
async function _save<T>(dir: string, key: string, data: T): Promise<void> {
  await ensureDirs();
  const filePath = join(dir, `${key}.json`);
  const tempPath = `${filePath}.${uuidv4()}.tmp`; // 고유한 임시 파일명

  try {
    // 1. 임시 파일에 쓰기
    await writeFile(tempPath, JSON.stringify(data, null, 2));
    // 2. 이름 변경 (Atomic Move)
    await rename(tempPath, filePath);
  } catch (error) {
    // 실패 시 임시 파일 삭제 시도
    try { await unlink(tempPath); } catch { }
    throw error;
  }
}

async function _load<T>(dir: string, key: string): Promise<T | null> {
  await ensureDirs();
  const filePath = join(dir, `${key}.json`);
  try {
    const data = await readFile(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function _list<T>(dir: string): Promise<T[]> {
  await ensureDirs();
  try {
    const files = await readdir(dir);
    const results: T[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const data = await _load<T>(dir, file.replace('.json', ''));
        if (data) results.push(data);
      }
    }
    return results;
  } catch {
    return [];
  }
}

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

  await _save(DIRS.runs, run.id, run);
  return run;
}

/**
 * Run 조회
 */
export async function getRun(runId: string): Promise<Run | null> {
  return await _load<Run>(DIRS.runs, runId);
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
  const run = await getRun(runId);
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

  await _save(DIRS.runs, runId, run);
}

/**
 * 모든 Run 목록 조회
 */
export async function listRuns(): Promise<Run[]> {
  const runs = await _list<Run>(DIRS.runs);
  return runs.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * 서버 재시작 시 실행 중인 모든 세션 정리
 */
export async function cleanupRunningSessions(): Promise<number> {
  let cleanedCount = 0;
  const runs = await _list<Run>(DIRS.runs);

  for (const run of runs) {
    if (run.status === 'running') {
      run.status = 'error';
      run.error_message = 'Server restarted or timeout';
      run.updated_at = new Date().toISOString();
      await _save(DIRS.runs, run.id, run);
      cleanedCount++;
      console.log(`[Storage] Cleaned up running session: ${run.id}`);
    }
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
  const events = (await _load<StageEvent[]>(DIRS.events, runId)) || [];
  events.push(event);
  await _save(DIRS.events, runId, events);
}

/**
 * Run의 모든 StageEvent 조회
 */
export async function getStageEvents(runId: string): Promise<StageEvent[]> {
  return (await _load<StageEvent[]>(DIRS.events, runId)) || [];
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
  const runArtifacts = (await _load<Record<string, unknown>>(DIRS.artifacts, runId)) || {};
  const key = `${stage}:${type}`;
  runArtifacts[key] = data;
  await _save(DIRS.artifacts, runId, runArtifacts);
}

/**
 * Artifact 조회
 */
export async function getArtifact<T>(
  runId: string,
  stage: string,
  type: ArtifactType
): Promise<T | null> {
  const runArtifacts = await _load<Record<string, unknown>>(DIRS.artifacts, runId);
  if (!runArtifacts) return null;
  const key = `${stage}:${type}`;
  return (runArtifacts[key] as T) || null;
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

  await _save(DIRS.hitl, packet.id, packet);
  return packet;
}

/**
 * HITL 패킷 조회
 */
export async function getHITLPacket(packetId: string): Promise<HITLPacket | null> {
  return await _load<HITLPacket>(DIRS.hitl, packetId);
}

/**
 * Run에 연결된 HITL 패킷 조회
 */
export async function getHITLPacketByRunId(runId: string): Promise<HITLPacket | null> {
  const packets = await _list<HITLPacket>(DIRS.hitl);
  for (const packet of packets) {
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
  const packet = await getHITLPacket(packetId);
  if (!packet) {
    throw new Error(`HITL packet not found: ${packetId}`);
  }

  packet.resolved_at = new Date().toISOString();
  packet.resolution = resolution;
  await _save(DIRS.hitl, packetId, packet);
}

/**
 * 대기 중인 HITL 패킷 목록 조회
 */
export async function listPendingHITLPackets(): Promise<HITLPacket[]> {
  const packets = await _list<HITLPacket>(DIRS.hitl);
  return packets
    .filter(p => !p.resolved_at)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

// ============================================
// 파일 저장 (기능 유지)
// ============================================

/**
 * 업로드된 파일 저장
 */
export async function saveFile(file: File): Promise<string> {
  await ensureDirs();
  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${uuidv4()}_${file.name}`;
  const filepath = join(UPLOAD_DIR, filename);
  await writeFile(filepath, buffer);
  return filepath;
}

/**
 * Base64 이미지로 파일 저장
 */
export async function saveBase64Image(base64Data: string, mimeType: string): Promise<string> {
  await ensureDirs();
  const extension = mimeType.split('/')[1] || 'png';
  const filename = `${uuidv4()}.${extension}`;
  const filepath = join(UPLOAD_DIR, filename);

  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');
  await writeFile(filepath, buffer);
  return filepath;
}

// ============================================
// 로그 스토리지 (파일 기반)
// ============================================

import type { RunLogReport } from './agentLogger';

/**
 * 실행 로그 저장
 */
export async function saveRunLog(log: RunLogReport): Promise<void> {
  await _save(LOG_DIR, log.run_id, log);
}

/**
 * 실행 로그 로드
 */
export async function loadRunLog(runId: string): Promise<RunLogReport | null> {
  return await _load<RunLogReport>(LOG_DIR, runId);
}
