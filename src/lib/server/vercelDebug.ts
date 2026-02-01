/** File: src/lib/server/vercelDebug.ts */
/**
 * Vercel 배포 환경 디버깅 모듈
 * - 환경 변수 검증
 * - Supabase 연결 테스트
 * - 파일시스템 접근 테스트
 * - 메모리 사용량 모니터링
 * - GUI 로그로 결과 출력
 */

import os from 'os';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { addAgentLog, startAgentLog, completeAgentLog } from './agentLogger';

// ============================================
// 환경 감지 (다중 신호 기반)
// ============================================

export interface VercelEnvInfo {
  isVercel: boolean;
  vercelEnv: string | undefined;      // 'production' | 'preview' | 'development'
  vercelRegion: string | undefined;
  vercelUrl: string | undefined;
  nodeEnv: string | undefined;
  platform: string;
  tmpDir: string;
  cwd: string;
  memoryUsage: NodeJS.MemoryUsage;
  detectionSignals: string[];  // 어떤 신호로 감지했는지 기록
}

/**
 * 환경 감지 (동기 - process.env 기반)
 * Vercel 감지: 여러 신호를 조합하여 정확도 향상
 */
export function detectEnvironment(): VercelEnvInfo {
  const signals: string[] = [];

  // Vercel 감지 신호들
  const vercelFlag = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
  const hasVercelEnv = !!process.env.VERCEL_ENV;
  const hasVercelUrl = !!process.env.VERCEL_URL;
  const hasVercelRegion = !!process.env.VERCEL_REGION;
  const cwdIsVercel = process.cwd().includes('/var/task') || process.cwd().includes('/vercel');
  const tmpIsVercel = os.tmpdir() === '/tmp';
  const isLinux = process.platform === 'linux';

  if (vercelFlag) signals.push('VERCEL=1');
  if (hasVercelEnv) signals.push(`VERCEL_ENV=${process.env.VERCEL_ENV}`);
  if (hasVercelUrl) signals.push('VERCEL_URL');
  if (hasVercelRegion) signals.push(`REGION=${process.env.VERCEL_REGION}`);
  if (cwdIsVercel) signals.push('CWD=/var/task');
  if (tmpIsVercel && isLinux) signals.push('TMP=/tmp+Linux');

  // 2개 이상의 신호가 있으면 Vercel로 판단
  const isVercel = vercelFlag || (signals.length >= 2);

  return {
    isVercel,
    vercelEnv: process.env.VERCEL_ENV,
    vercelRegion: process.env.VERCEL_REGION,
    vercelUrl: process.env.VERCEL_URL,
    nodeEnv: process.env.NODE_ENV,
    platform: process.platform,
    tmpDir: os.tmpdir(),
    cwd: process.cwd(),
    memoryUsage: process.memoryUsage(),
    detectionSignals: signals
  };
}

/**
 * 환경 감지 (비동기 - SvelteKit $env 기반, 더 정확)
 */
export async function detectEnvironmentAsync(): Promise<VercelEnvInfo> {
  const { env } = await import('$env/dynamic/private');
  const signals: string[] = [];

  // Vercel 감지 신호들 (SvelteKit $env 사용)
  const vercelFlag = env.VERCEL === '1' || env.VERCEL === 'true';
  const hasVercelEnv = !!env.VERCEL_ENV;
  const hasVercelUrl = !!env.VERCEL_URL;
  const hasVercelRegion = !!env.VERCEL_REGION;
  const cwdIsVercel = process.cwd().includes('/var/task') || process.cwd().includes('/vercel');
  const tmpIsVercel = os.tmpdir() === '/tmp';
  const isLinux = process.platform === 'linux';

  if (vercelFlag) signals.push('VERCEL=1');
  if (hasVercelEnv) signals.push(`VERCEL_ENV=${env.VERCEL_ENV}`);
  if (hasVercelUrl) signals.push('VERCEL_URL');
  if (hasVercelRegion) signals.push(`REGION=${env.VERCEL_REGION}`);
  if (cwdIsVercel) signals.push('CWD=/var/task');
  if (tmpIsVercel && isLinux) signals.push('TMP=/tmp+Linux');

  // 2개 이상의 신호가 있으면 Vercel로 판단
  const isVercel = vercelFlag || (signals.length >= 2);

  return {
    isVercel,
    vercelEnv: env.VERCEL_ENV,
    vercelRegion: env.VERCEL_REGION,
    vercelUrl: env.VERCEL_URL,
    nodeEnv: env.NODE_ENV,
    platform: process.platform,
    tmpDir: os.tmpdir(),
    cwd: process.cwd(),
    memoryUsage: process.memoryUsage(),
    detectionSignals: signals
  };
}

// ============================================
// 환경 변수 검증 (SvelteKit $env 사용)
// ============================================

export interface EnvCheckResult {
  name: string;
  exists: boolean;
  masked: string | null;  // 앞 4자만 표시
  required: boolean;
  requiredFor: 'ALL' | 'VERCEL' | 'LOCAL';  // 어느 환경에서 필수인지
}

/**
 * 환경변수 검증 (비동기 - SvelteKit $env 사용)
 */
export async function checkRequiredEnvVarsAsync(isVercel: boolean): Promise<EnvCheckResult[]> {
  const { env } = await import('$env/dynamic/private');

  const vars = [
    { name: 'OPENAI_API_KEY', required: true, requiredFor: 'ALL' as const },
    { name: 'SUPABASE_URL', required: isVercel, requiredFor: 'VERCEL' as const },
    { name: 'SUPABASE_ANON_KEY', required: isVercel, requiredFor: 'VERCEL' as const },
    { name: 'SUPABASE_SERVICE_KEY', required: false, requiredFor: 'VERCEL' as const },
    { name: 'VERCEL', required: false, requiredFor: 'ALL' as const },
    { name: 'VERCEL_ENV', required: false, requiredFor: 'VERCEL' as const },
    { name: 'MOCK_LLM', required: false, requiredFor: 'ALL' as const }
  ];

  return vars.map(v => {
    const value = (env as Record<string, string | undefined>)[v.name];
    return {
      name: v.name,
      exists: !!value,
      masked: value ? `${value.substring(0, 4)}****` : null,
      required: v.required,
      requiredFor: v.requiredFor
    };
  });
}

// 동기 버전 (하위 호환성)
export function checkRequiredEnvVars(): EnvCheckResult[] {
  const vars = [
    { name: 'OPENAI_API_KEY', required: true, requiredFor: 'ALL' as const },
    { name: 'SUPABASE_URL', required: true, requiredFor: 'VERCEL' as const },
    { name: 'SUPABASE_ANON_KEY', required: true, requiredFor: 'VERCEL' as const },
    { name: 'SUPABASE_SERVICE_KEY', required: false, requiredFor: 'VERCEL' as const },
    { name: 'VERCEL', required: false, requiredFor: 'ALL' as const },
    { name: 'VERCEL_ENV', required: false, requiredFor: 'VERCEL' as const },
    { name: 'MOCK_LLM', required: false, requiredFor: 'ALL' as const }
  ];

  return vars.map(v => {
    const value = process.env[v.name];
    return {
      name: v.name,
      exists: !!value,
      masked: value ? `${value.substring(0, 4)}****` : null,
      required: v.required,
      requiredFor: v.requiredFor
    };
  });
}

// ============================================
// 환경별 대응 전략
// ============================================

export interface EnvironmentStrategy {
  storageType: 'SUPABASE' | 'LOCAL_FS';
  tempDir: string;
  canWriteCwd: boolean;
  requiresSupabase: boolean;
  maxExecutionTime: number;  // ms
  recommendations: string[];
}

/**
 * 환경에 따른 대응 전략 결정
 */
export function getEnvironmentStrategy(env: VercelEnvInfo): EnvironmentStrategy {
  if (env.isVercel) {
    return {
      storageType: 'SUPABASE',
      tempDir: '/tmp',
      canWriteCwd: false,
      requiresSupabase: true,
      maxExecutionTime: 60000,  // Vercel 60초 제한
      recommendations: [
        'Supabase를 통한 데이터 영속성 필수',
        '/tmp만 쓰기 가능 (임시 파일용)',
        '60초 내 실행 완료 필요',
        'Cold start 대비 필요'
      ]
    };
  }

  return {
    storageType: 'LOCAL_FS',
    tempDir: env.tmpDir,
    canWriteCwd: true,
    requiresSupabase: false,
    maxExecutionTime: 600000,  // 로컬 10분
    recommendations: [
      '로컬 파일시스템 사용 가능',
      'Supabase 선택적 사용',
      '실행 시간 제한 없음'
    ]
  };
}

// ============================================
// Supabase 연결 테스트
// ============================================

export interface SupabaseTestResult {
  connected: boolean;
  canUpload: boolean;
  canDownload: boolean;
  error: string | null;
  latencyMs: number;
}

export async function testSupabaseConnection(): Promise<SupabaseTestResult> {
  const startTime = Date.now();
  const result: SupabaseTestResult = {
    connected: false,
    canUpload: false,
    canDownload: false,
    error: null,
    latencyMs: 0
  };

  try {
    const { env } = await import('$env/dynamic/private');

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      result.error = 'SUPABASE_URL 또는 SUPABASE_ANON_KEY 누락';
      result.latencyMs = Date.now() - startTime;
      return result;
    }

    const { uploadJson, downloadJson } = await import('./services/supabase_storage');

    // 테스트 데이터 업로드
    const testKey = `_debug_test_${Date.now()}.json`;
    const testData = { test: true, timestamp: new Date().toISOString() };

    await uploadJson(testKey, testData);
    result.canUpload = true;
    result.connected = true;

    // 다운로드 테스트
    const downloaded = await downloadJson<typeof testData>(testKey);
    if (downloaded && downloaded.test === true) {
      result.canDownload = true;
    }

    result.latencyMs = Date.now() - startTime;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    result.latencyMs = Date.now() - startTime;
  }

  return result;
}

// ============================================
// 파일시스템 테스트
// ============================================

export interface FSTestResult {
  tmpWritable: boolean;
  cwdWritable: boolean;
  tmpTestPath: string;
  cwdTestPath: string;
  tmpError: string | null;
  cwdError: string | null;
}

export async function testFileSystem(): Promise<FSTestResult> {
  const result: FSTestResult = {
    tmpWritable: false,
    cwdWritable: false,
    tmpTestPath: join(os.tmpdir(), `_debug_test_${Date.now()}.txt`),
    cwdTestPath: join(process.cwd(), 'data', `_debug_test_${Date.now()}.txt`),
    tmpError: null,
    cwdError: null
  };

  // /tmp 테스트
  try {
    await writeFile(result.tmpTestPath, 'test');
    const content = await readFile(result.tmpTestPath, 'utf-8');
    if (content === 'test') {
      result.tmpWritable = true;
    }
    await unlink(result.tmpTestPath);
  } catch (err) {
    result.tmpError = err instanceof Error ? err.message : String(err);
  }

  // cwd/data 테스트
  try {
    await mkdir(join(process.cwd(), 'data'), { recursive: true });
    await writeFile(result.cwdTestPath, 'test');
    const content = await readFile(result.cwdTestPath, 'utf-8');
    if (content === 'test') {
      result.cwdWritable = true;
    }
    await unlink(result.cwdTestPath);
  } catch (err) {
    result.cwdError = err instanceof Error ? err.message : String(err);
  }

  return result;
}

// ============================================
// 메모리 모니터링
// ============================================

export interface MemoryInfo {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  heapUsagePercent: number;
}

export function getMemoryInfo(): MemoryInfo {
  const mem = process.memoryUsage();
  const toMB = (bytes: number) => Math.round(bytes / 1024 / 1024 * 100) / 100;

  return {
    heapUsedMB: toMB(mem.heapUsed),
    heapTotalMB: toMB(mem.heapTotal),
    rssMB: toMB(mem.rss),
    externalMB: toMB(mem.external),
    heapUsagePercent: Math.round(mem.heapUsed / mem.heapTotal * 100)
  };
}

// ============================================
// 종합 디버깅 실행 및 GUI 로그 출력
// ============================================

export interface VercelDebugReport {
  env: VercelEnvInfo;
  strategy: EnvironmentStrategy;
  envVars: EnvCheckResult[];
  supabase: SupabaseTestResult;
  filesystem: FSTestResult;
  memory: MemoryInfo;
  issues: string[];
  timestamp: string;
}

/**
 * Vercel 디버깅 진단을 실행하고 결과를 GUI 로그에 출력
 * @param runId - 로그를 연결할 Run ID
 * @returns 진단 결과 리포트
 */
export async function runVercelDiagnostics(runId: string): Promise<VercelDebugReport> {
  // 디버깅 에이전트 시작
  await startAgentLog(runId, 'Orchestrator');

  await addAgentLog(runId, 'Orchestrator', 'INFO', 'VERCEL_DEBUG_START',
    '🔍 Vercel 배포 환경 진단 시작...');

  const issues: string[] = [];

  // 1. 환경 감지 (비동기 - 더 정확)
  const env = await detectEnvironmentAsync();
  const signalsStr = env.detectionSignals.length > 0
    ? ` [신호: ${env.detectionSignals.join(', ')}]`
    : '';

  await addAgentLog(runId, 'Orchestrator', 'INFO', 'ENV_DETECT',
    `환경: ${env.isVercel ? '☁️ VERCEL' : '💻 LOCAL'} | ${env.nodeEnv} | ${env.platform}${signalsStr}`,
    {
      vercelEnv: env.vercelEnv,
      region: env.vercelRegion,
      signals: env.detectionSignals,
      cwd: env.cwd,
      tmpDir: env.tmpDir
    }
  );

  // 2. 환경 전략 결정 및 로깅
  const strategy = getEnvironmentStrategy(env);
  await addAgentLog(runId, 'Orchestrator', 'INFO', 'STRATEGY',
    `📋 전략: ${strategy.storageType} | Supabase필수: ${strategy.requiresSupabase} | 제한시간: ${strategy.maxExecutionTime/1000}초`,
    { recommendations: strategy.recommendations }
  );

  if (env.isVercel) {
    await addAgentLog(runId, 'Orchestrator', 'WARNING', 'VERCEL_CONSTRAINTS',
      `⚠️ Vercel 제약: CWD 읽기전용, /tmp만 쓰기가능, 60초 제한`);
  }

  // 3. 환경 변수 검증 (비동기 - SvelteKit $env 사용)
  const envVars = await checkRequiredEnvVarsAsync(env.isVercel);
  const missingRequired = envVars.filter(v => v.required && !v.exists);

  for (const v of envVars) {
    if (v.required && !v.exists) {
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'ENV_MISSING',
        `❌ 필수 환경변수 누락: ${v.name}`);
      issues.push(`필수 환경변수 누락: ${v.name}`);
    } else if (v.exists) {
      await addAgentLog(runId, 'Orchestrator', 'DEBUG', 'ENV_CHECK',
        `✓ ${v.name}: ${v.masked}`);
    }
  }

  // 3. Supabase 연결 테스트 (Vercel에서 필수)
  let supabase: SupabaseTestResult;
  if (env.isVercel || envVars.find(v => v.name === 'SUPABASE_URL')?.exists) {
    await addAgentLog(runId, 'Orchestrator', 'INFO', 'SUPABASE_TEST_START',
      '🔌 Supabase 연결 테스트 중...');

    supabase = await testSupabaseConnection();

    if (supabase.connected) {
      await addAgentLog(runId, 'Orchestrator', 'SUCCESS', 'SUPABASE_CONNECTED',
        `✅ Supabase 연결 성공 (${supabase.latencyMs}ms)`,
        { canUpload: supabase.canUpload, canDownload: supabase.canDownload }
      );
    } else {
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'SUPABASE_FAILED',
        `❌ Supabase 연결 실패: ${supabase.error}`);
      issues.push(`Supabase 연결 실패: ${supabase.error}`);
    }
  } else {
    supabase = { connected: false, canUpload: false, canDownload: false, error: 'Not configured', latencyMs: 0 };
    await addAgentLog(runId, 'Orchestrator', 'DEBUG', 'SUPABASE_SKIP',
      'Supabase 설정 없음 - 로컬 모드');
  }

  // 4. 파일시스템 테스트
  await addAgentLog(runId, 'Orchestrator', 'INFO', 'FS_TEST_START',
    '💾 파일시스템 접근 테스트 중...');

  const filesystem = await testFileSystem();

  if (filesystem.tmpWritable) {
    await addAgentLog(runId, 'Orchestrator', 'SUCCESS', 'FS_TMP_OK',
      '✅ /tmp 쓰기 가능');
  } else {
    await addAgentLog(runId, 'Orchestrator', 'ERROR', 'FS_TMP_FAIL',
      `❌ /tmp 쓰기 실패: ${filesystem.tmpError}`);
    issues.push(`/tmp 쓰기 실패: ${filesystem.tmpError}`);
  }

  if (filesystem.cwdWritable) {
    await addAgentLog(runId, 'Orchestrator', 'SUCCESS', 'FS_CWD_OK',
      '✅ cwd/data 쓰기 가능');
  } else {
    if (env.isVercel) {
      await addAgentLog(runId, 'Orchestrator', 'WARNING', 'FS_CWD_READONLY',
        `⚠️ cwd/data 읽기전용 (Vercel 정상): ${filesystem.cwdError}`);
    } else {
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'FS_CWD_FAIL',
        `❌ cwd/data 쓰기 실패: ${filesystem.cwdError}`);
      issues.push(`cwd/data 쓰기 실패: ${filesystem.cwdError}`);
    }
  }

  // 5. 메모리 상태
  const memory = getMemoryInfo();
  const memLevel = memory.heapUsagePercent > 80 ? 'WARNING' : 'INFO';
  await addAgentLog(runId, 'Orchestrator', memLevel, 'MEMORY_STATUS',
    `📊 메모리: ${memory.heapUsedMB}MB / ${memory.heapTotalMB}MB (${memory.heapUsagePercent}%)`,
    { rss: memory.rssMB, external: memory.externalMB }
  );

  if (memory.heapUsagePercent > 80) {
    issues.push(`메모리 사용량 높음: ${memory.heapUsagePercent}%`);
  }

  // 6. Vercel 특화 이슈 체크
  if (env.isVercel) {
    if (!supabase.connected) {
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'VERCEL_CRITICAL',
        '🚨 CRITICAL: Vercel에서 Supabase 없이는 데이터 영속성 불가!');
      issues.push('Vercel에서 Supabase 연결 필수');
    }

    if (!filesystem.tmpWritable) {
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'VERCEL_CRITICAL',
        '🚨 CRITICAL: /tmp 쓰기 불가 - 임시 파일 처리 불가!');
      issues.push('/tmp 접근 불가');
    }
  }

  // 7. 결과 요약
  const report: VercelDebugReport = {
    env,
    strategy,
    envVars,
    supabase,
    filesystem,
    memory,
    issues,
    timestamp: new Date().toISOString()
  };

  if (issues.length === 0) {
    await addAgentLog(runId, 'Orchestrator', 'SUCCESS', 'VERCEL_DEBUG_COMPLETE',
      `✅ 환경 진단 완료 - 문제 없음 (${env.isVercel ? 'Vercel' : 'Local'})`);
  } else {
    await addAgentLog(runId, 'Orchestrator', 'WARNING', 'VERCEL_DEBUG_COMPLETE',
      `⚠️ 환경 진단 완료 - ${issues.length}개 이슈 발견`,
      { issues }
    );
  }

  return report;
}

/**
 * 경량 환경 체크 (실행 시작 시 빠르게 확인)
 * SvelteKit에서는 $env/dynamic/private를 통해 환경변수 접근
 */
export async function quickEnvCheck(runId: string): Promise<{
  ok: boolean;
  critical: string[];
  env: VercelEnvInfo;
  strategy: EnvironmentStrategy;
}> {
  const critical: string[] = [];

  // 비동기 환경 감지 (더 정확)
  const env = await detectEnvironmentAsync();
  const strategy = getEnvironmentStrategy(env);

  // SvelteKit 환경변수 접근
  const { env: privateEnv } = await import('$env/dynamic/private');

  const signalsStr = env.detectionSignals.length > 0
    ? ` [${env.detectionSignals.slice(0, 3).join(', ')}${env.detectionSignals.length > 3 ? '...' : ''}]`
    : '';

  await addAgentLog(runId, 'Orchestrator', 'DEBUG', 'QUICK_ENV_CHECK',
    `환경: ${env.isVercel ? '☁️ VERCEL' : '💻 LOCAL'} | ${env.nodeEnv}${signalsStr}`);

  // 전략 로깅
  await addAgentLog(runId, 'Orchestrator', 'DEBUG', 'STRATEGY',
    `전략: ${strategy.storageType} | 제한: ${strategy.maxExecutionTime/1000}초`);

  // Vercel에서 필수 체크
  if (env.isVercel) {
    if (!privateEnv.SUPABASE_URL || !privateEnv.SUPABASE_ANON_KEY) {
      critical.push('Supabase 설정 누락 (Vercel 필수)');
      await addAgentLog(runId, 'Orchestrator', 'ERROR', 'VERCEL_SUPABASE_MISSING',
        '🚨 Vercel 환경에서 SUPABASE 설정 필수!');
    }
  }

  // OPENAI_API_KEY 체크 (SvelteKit 방식)
  if (!privateEnv.OPENAI_API_KEY && privateEnv.MOCK_LLM !== 'true') {
    critical.push('OPENAI_API_KEY 누락');
    await addAgentLog(runId, 'Orchestrator', 'ERROR', 'OPENAI_KEY_MISSING',
      '🚨 OPENAI_API_KEY 환경변수 누락!');
  }

  return { ok: critical.length === 0, critical, env, strategy };
}
