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

// detect if running on Vercel or explicitly enabled via env
const USE_SUPABASE = process.env.VERCEL === '1' || process.env.USE_SUPABASE === 'true';
const BASE_DIR = USE_SUPABASE ? os.tmpdir() : process.cwd();

const DATA_DIR = join(BASE_DIR, 'data');
const UPLOAD_DIR = join(BASE_DIR, 'uploads');
const LOG_DIR = join(BASE_DIR, 'logs');

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

// 헬퍼: 파일 기반 저장/로드 (Hybrid: Local FS or Supabase)
async function _save<T>(dir: string, key: string, data: T): Promise<void> {
  // Determine Folder Name from dir path
  // dir is like ".../data/runs" or ".../data/events"
  // We want "runs", "events", etc.
  const folder = dir.split(/[\\/]/).pop() || 'misc';

  if (USE_SUPABASE) {
    try {
      const { uploadJson } = await import('./services/supabase_storage');
      await uploadJson(`${folder}/${key}.json`, data);
      return;
    } catch (e) {
      console.error(`[Storage] Supabase Save Failed (${folder}/${key}):`, e);
      // Fallback to temp fs? No, Vercel tmp is unreliable.
      throw e;
    }
  }

  // Local FS Logic
  await ensureDirs();
  const filePath = join(dir, `${key}.json`);
  const tempPath = `${filePath}.${uuidv4()}.tmp`;

  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2));
    let retryCount = 0;
    const MAX_RETRIES = 5;
    while (retryCount < MAX_RETRIES) {
      try {
        await rename(tempPath, filePath);
        return;
      } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'EBUSY') {
          retryCount++;
          if (retryCount >= MAX_RETRIES) throw err;
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }
        throw err;
      }
    }
  } catch (error) {
    try { await unlink(tempPath); } catch { }
    throw error;
  }
}

async function _load<T>(dir: string, key: string): Promise<T | null> {
  const folder = dir.split(/[\\/]/).pop() || 'misc';

  if (USE_SUPABASE) {
    try {
      const { downloadJson } = await import('./services/supabase_storage');
      return await downloadJson<T>(`${folder}/${key}.json`);
    } catch (e) {
      console.warn(`[Storage] Supabase Load Failed (${folder}/${key}):`, e);
      return null;
    }
  }

  // Local FS Logic
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
  const folder = dir.split(/[\\/]/).pop() || 'misc';

  if (USE_SUPABASE) {
    try {
      const { listJsonFiles, downloadJson } = await import('./services/supabase_storage');
      const files = await listJsonFiles(folder);
      const results: T[] = [];
      // Parallel fetch for list items might be heavy, but listRuns is usually small page size
      // Optimizing: fetch all in parallel
      const tasks = files.map(f => downloadJson<T>(`${folder}/${f}`));
      const loaded = await Promise.all(tasks);
      return loaded.filter((item) => item !== null) as T[];
    } catch (e) {
      console.error(`[Storage] Supabase List Failed (${folder}):`, e);
      return [];
    }
  }

  // Local FS Logic
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

// ============================================
// Run 관리
// ============================================

/**
 * 새 Run 생성
 */
export async function createRun(
  filePaths: string[],
  executionMode?: 'FAST' | 'MULTI_AGENT',
  fileMetadata?: Record<string, { original_name: string }>
): Promise<Run> {
  const run: Run = {
    id: uuidv4(),
    status: 'pending',
    files: filePaths,
    execution_mode: executionMode,
    file_metadata: fileMetadata,
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
 * Run 목록 조회
 */
export async function listRuns(): Promise<Run[]> {
  return await _list<Run>(DIRS.runs);
}

// ============================================
// 파일 저장 (기능 유지)
// ============================================

/**
 * 업로드된 파일 저장 (Safe Filename Strategy)
 * - 원본 파일명은 URL 인코딩 이슈 등으로 문제를 일으킬 수 있음
 * - 무조건 UUID + 확장자로 저장하고, 원본 이름은 메타데이터로 관리 권장
 */
export async function saveFile(file: File): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
  const safeFilename = `${uuidv4()}.${ext}`;

  if (USE_SUPABASE) {
    try {
      const { uploadRawFile, getRawFileUrl } = await import('./services/supabase_storage');
      const uploadPath = `uploads/${safeFilename}`;
      await uploadRawFile(buffer, uploadPath, file.type || 'application/octet-stream');
      return getRawFileUrl(uploadPath);
    } catch (e) {
      console.error('[Storage] Supabase Upload Failed, falling back to temp:', e);
      // Fallback is tricky if we want persistent URL. But better than crash.
      // Actually throw is better so we know it failed.
      throw e;
    }
  }

  await ensureDirs();
  const filepath = join(UPLOAD_DIR, safeFilename);
  await writeFile(filepath, buffer);
  return filepath;
}

/**
 * Base64 이미지로 파일 저장
 */
export async function saveBase64Image(base64Data: string, mimeType: string): Promise<string> {
  const extension = mimeType.split('/')[1] || 'png';
  // 확장자도 정규화 (예: jpeg+xml -> jpeg)
  const sanitizedExt = extension.replace(/[^\w]/g, '').toLowerCase();
  const filename = `${uuidv4()}.${sanitizedExt}`;

  const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  if (USE_SUPABASE) {
    try {
      const { uploadRawFile, getRawFileUrl } = await import('./services/supabase_storage');
      const uploadPath = `uploads/${filename}`;
      await uploadRawFile(buffer, uploadPath, mimeType);
      return getRawFileUrl(uploadPath);
    } catch (e) {
      console.error('[Storage] Supabase Base64 Upload Failed:', e);
      throw e;
    }
  }

  await ensureDirs();
  const filepath = join(UPLOAD_DIR, filename);
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

// ============================================
// 추가 Export 함수들 (Missing Exports 해결)
// ============================================

/**
 * 실행 상태 업데이트
 */
export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  stage?: StageName,
  error?: string
): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;

  run.status = status;
  if (stage) run.current_stage = stage;
  if (error) run.error = error;
  run.updated_at = new Date().toISOString();

  await _save(DIRS.runs, runId, run);
}

/**
 * StageEvent 저장
 */
export async function saveStageEvent(runId: string, event: StageEvent): Promise<void> {
  await _save(DIRS.events, `${runId}_${Date.now()}_${event.stage_name}`, event);
}

/**
 * 아티팩트 저장
 */
export async function saveArtifact(
  runId: string,
  stage: StageName,
  name: string,
  data: any
): Promise<void> {
  const key = `${runId}_${stage}_${name}`;
  await _save(DIRS.artifacts, key, data);
}

/**
 * 아티팩트 조회
 */
export async function getArtifact<T>(
  runId: string,
  stage: StageName,
  name: string
): Promise<T | null> {
  const key = `${runId}_${stage}_${name}`;
  return await _load<T>(DIRS.artifacts, key);
}

/**
 * HITL 패킷 생성 및 저장
 */
export async function createHITLPacket(
  runId: string,
  stage: StageName,
  context: any,
  documentInfo: { company_name?: string | null, document_date?: string | null, shareholder_names?: string[] }
): Promise<HITLPacket> {
  // context 내에서 triggers 추출 (없으면 빈 배열)
  let triggers: RuleTrigger[] = [];
  if (context.triggers) {
    triggers = context.triggers;
  } else if (context.validationReport && context.validationReport.triggers) {
    triggers = context.validationReport.triggers;
  } else if (context.normalized && context.normalized.normalization_notes) {
    // triggers가 명시적으로 없지만 normalized doc이 있는 경우 (예: B단계)는 빈 배열
  }

  // Determine required action
  const requiredAction = determineRequiredAction(triggers);

  const packet: HITLPacket = {
    packet_id: uuidv4(),
    id: uuidv4(), // Legacy id
    doc_id: runId, // Using runId as doc_id for now
    run_id: runId,
    stage,
    created_at: new Date().toISOString(),
    status: 'PENDING',
    reason_codes: extractHITLReasonCodes(triggers),
    required_action: requiredAction,
    triggers: triggers, // Added missing triggers
    operator_notes: [], // Added empty notes
    payload: {}, // Empty payload map, context is in context_data
    context_data: context,
    document_snapshot: {
      company_name: documentInfo.company_name || '불명',
      document_date: documentInfo.document_date || '불명',
      shareholder_count: documentInfo.shareholder_names?.length || 0,
      preview_names: documentInfo.shareholder_names?.slice(0, 5) || []
    }
  };

  await _save(DIRS.hitl, packet.packet_id, packet);
  return packet;
}

/**
 * 실행 중인 세션 정리 (Startup 시 호출)
 */
export async function cleanupRunningSessions(): Promise<number> {
  const runs = await _list<Run>(DIRS.runs);
  let cleaned = 0;
  for (const run of runs) {
    if (run.status === 'running') {
      run.status = 'error';
      run.error = 'Server restarted';
      await _save(DIRS.runs, run.id, run);
      cleaned++;
    }
  }
  return cleaned;
}

/**
 * 스토리지 제공자 업데이트 (Run 메타데이터)
 */
export async function updateRunStorageProvider(runId: string, provider: 'LOCAL' | 'SUPABASE'): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  (run as any).storage_provider = provider;
  await _save(DIRS.runs, runId, run);
}

/**
 * Run에 대한 Stage Events 조회
 */
export async function getStageEvents(runId: string): Promise<StageEvent[]> {
  const events: StageEvent[] = [];

  if (USE_SUPABASE) {
    // Supabase: List files and filter by name before downloading
    try {
      const { listJsonFiles, downloadJson } = await import('./services/supabase_storage');
      const files = await listJsonFiles('events');

      const targetFiles = files.filter(f => f.startsWith(runId) && f.endsWith('.json'));
      const tasks = targetFiles.map(f => downloadJson<StageEvent>(`events/${f}`));
      const loaded = await Promise.all(tasks);

      loaded.forEach(item => {
        if (item) events.push(item);
      });
    } catch (e) {
      console.error('[Storage] Failed to load stage events from Supabase:', e);
    }
  } else {
    // Local: Filter by filename
    try {
      await ensureDirs();
      const files = await readdir(DIRS.events);
      for (const file of files) {
        if (file.startsWith(runId) && file.endsWith('.json')) {
          const data = await _load<StageEvent>(DIRS.events, file.replace('.json', ''));
          if (data) events.push(data);
        }
      }
    } catch {
      // Ignore errors (e.g. dir not found)
    }
  }

  return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

/**
 * Run에 대한 HITL Packet 조회
 */
export async function getHITLPacketByRunId(runId: string): Promise<HITLPacket | null> {
  const allPackets = await _list<HITLPacket>(DIRS.hitl);
  const packets = allPackets.filter(p => p.run_id === runId);
  if (packets.length === 0) return null;
  // Return latest
  return packets.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
}

/**
 * HITL Packet ID로 조회
 */
export async function getHITLPacket(packetId: string): Promise<HITLPacket | null> {
  return await _load<HITLPacket>(DIRS.hitl, packetId);
}

/**
 * 대기 중인 HITL 패킷 목록 조회
 */
export async function listPendingHITLPackets(): Promise<HITLPacket[]> {
  const allPackets = await _list<HITLPacket>(DIRS.hitl);
  return allPackets
    .filter(p => p.status === 'PENDING')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * HITL 패킷 해결 처리
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

  packet.status = 'RESOLVED';
  packet.resolved_at = new Date().toISOString();
  packet.resolution = {
    action_taken: resolution.action_taken,
    resolved_by: resolution.resolved_by,
    corrections: resolution.corrections
  };

  await _save(DIRS.hitl, packetId, packet);
}
