import os from 'os';

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
