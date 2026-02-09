import os from 'os';

// ============================================
// 환경 감지 (다중 신호 기반) - Enhanced v2.0
// ============================================

/**
 * 지원하는 서버리스 플랫폼 목록
 */
export type ServerlessPlatform =
    | 'vercel'
    | 'netlify'
    | 'cloudflare'
    | 'railway'
    | 'render'
    | 'local'
    | 'unknown';

/**
 * 환경별 런타임 프로파일
 */
export interface RuntimeProfile {
    platform: ServerlessPlatform;
    maxMemoryMB: number;
    maxTimeoutSeconds: number;
    recommendedModel: string;
    canSpawnProcess: boolean;
    hasWritableFS: boolean;
    tempDir: string;
}

export interface VercelEnvInfo {
    isVercel: boolean;
    isNetlify: boolean;
    isCloudflare: boolean;
    isRailway: boolean;
    isRender: boolean;
    isProduction: boolean;
    isDevelopment: boolean;
    platform: ServerlessPlatform;
    vercelEnv: string | undefined;      // 'production' | 'preview' | 'development'
    vercelRegion: string | undefined;
    vercelUrl: string | undefined;
    nodeEnv: string | undefined;
    osPlatform: string;
    tmpDir: string;
    cwd: string;
    memoryUsage: NodeJS.MemoryUsage;
    detectionSignals: string[];  // 어떤 신호로 감지했는지 기록
    runtimeProfile: RuntimeProfile;
}

/**
 * 플랫폼별 기본 런타임 프로파일
 */
const RUNTIME_PROFILES: Record<ServerlessPlatform, RuntimeProfile> = {
    vercel: {
        platform: 'vercel',
        maxMemoryMB: 1024,
        maxTimeoutSeconds: 60,
        recommendedModel: 'gpt-4o-mini',
        canSpawnProcess: false,  // spawn() 불안정
        hasWritableFS: false,    // /tmp만 가능
        tempDir: '/tmp'
    },
    netlify: {
        platform: 'netlify',
        maxMemoryMB: 1024,
        maxTimeoutSeconds: 26,
        recommendedModel: 'gpt-4o-mini',
        canSpawnProcess: false,
        hasWritableFS: false,
        tempDir: '/tmp'
    },
    cloudflare: {
        platform: 'cloudflare',
        maxMemoryMB: 128,
        maxTimeoutSeconds: 30,
        recommendedModel: 'gpt-4o-mini',
        canSpawnProcess: false,
        hasWritableFS: false,
        tempDir: ''  // No FS access
    },
    railway: {
        platform: 'railway',
        maxMemoryMB: 8192,
        maxTimeoutSeconds: 300,
        recommendedModel: 'gpt-5',
        canSpawnProcess: true,
        hasWritableFS: true,
        tempDir: '/tmp'
    },
    render: {
        platform: 'render',
        maxMemoryMB: 512,
        maxTimeoutSeconds: 60,
        recommendedModel: 'gpt-4o-mini',
        canSpawnProcess: true,
        hasWritableFS: true,
        tempDir: '/tmp'
    },
    local: {
        platform: 'local',
        maxMemoryMB: 16384,
        maxTimeoutSeconds: 600,
        recommendedModel: 'gpt-4o-mini',  // 개발 시 빠른 모델
        canSpawnProcess: true,
        hasWritableFS: true,
        tempDir: os.tmpdir()
    },
    unknown: {
        platform: 'unknown',
        maxMemoryMB: 1024,
        maxTimeoutSeconds: 60,
        recommendedModel: 'gpt-4o-mini',
        canSpawnProcess: false,
        hasWritableFS: false,
        tempDir: '/tmp'
    }
};

/**
 * 환경 감지 (동기 - process.env 기반)
 * 다중 플랫폼 지원: Vercel, Netlify, Cloudflare, Railway, Render
 */
export function detectEnvironment(): VercelEnvInfo {
    const signals: string[] = [];

    // Vercel 감지 신호들
    const vercelFlag = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
    const hasVercelEnv = !!process.env.VERCEL_ENV;
    const hasVercelUrl = !!process.env.VERCEL_URL;
    const hasVercelRegion = !!process.env.VERCEL_REGION;
    const cwdIsVercel = process.cwd().includes('/var/task') || process.cwd().includes('/vercel');

    // Netlify 감지
    const netlifyFlag = process.env.NETLIFY === 'true' || !!process.env.NETLIFY_DEV;
    const hasNetlifyContext = !!process.env.CONTEXT;

    // Cloudflare 감지
    const cloudflareFlag = !!process.env.CF_PAGES || !!process.env.CF_PAGES_URL;

    // Railway 감지
    const railwayFlag = !!process.env.RAILWAY_ENVIRONMENT;

    // Render 감지
    const renderFlag = !!process.env.RENDER || !!process.env.IS_PULL_REQUEST;

    // 공통 신호
    const tmpIsVercel = os.tmpdir() === '/tmp';
    const isLinux = process.platform === 'linux';
    const nodeEnv = process.env.NODE_ENV;
    const isDevelopment = nodeEnv === 'development' || process.env.DEV === 'true';

    // 신호 기록
    if (vercelFlag) signals.push('VERCEL=1');
    if (hasVercelEnv) signals.push(`VERCEL_ENV=${process.env.VERCEL_ENV}`);
    if (hasVercelUrl) signals.push('VERCEL_URL');
    if (hasVercelRegion) signals.push(`REGION=${process.env.VERCEL_REGION}`);
    if (cwdIsVercel) signals.push('CWD=/var/task');
    if (netlifyFlag) signals.push('NETLIFY');
    if (hasNetlifyContext) signals.push(`CONTEXT=${process.env.CONTEXT}`);
    if (cloudflareFlag) signals.push('CF_PAGES');
    if (railwayFlag) signals.push('RAILWAY');
    if (renderFlag) signals.push('RENDER');
    if (tmpIsVercel && isLinux) signals.push('TMP=/tmp+Linux');
    if (isDevelopment) signals.push('NODE_ENV=development');

    // 플랫폼 판정
    let platform: ServerlessPlatform = 'unknown';
    const isVercel = vercelFlag || (hasVercelEnv && hasVercelUrl);
    const isNetlify = netlifyFlag || hasNetlifyContext;
    const isCloudflare = cloudflareFlag;
    const isRailway = railwayFlag;
    const isRender = renderFlag;

    if (isVercel) platform = 'vercel';
    else if (isNetlify) platform = 'netlify';
    else if (isCloudflare) platform = 'cloudflare';
    else if (isRailway) platform = 'railway';
    else if (isRender) platform = 'render';
    else if (isDevelopment || (!isLinux && !tmpIsVercel)) platform = 'local';

    const isProduction = process.env.VERCEL_ENV === 'production' ||
        process.env.CONTEXT === 'production' ||
        process.env.NODE_ENV === 'production';

    const runtimeProfile = { ...RUNTIME_PROFILES[platform] };
    runtimeProfile.tempDir = os.tmpdir();

    return {
        isVercel,
        isNetlify,
        isCloudflare,
        isRailway,
        isRender,
        isProduction,
        isDevelopment,
        platform,
        vercelEnv: process.env.VERCEL_ENV,
        vercelRegion: process.env.VERCEL_REGION,
        vercelUrl: process.env.VERCEL_URL,
        nodeEnv: process.env.NODE_ENV,
        osPlatform: process.platform,
        tmpDir: os.tmpdir(),
        cwd: process.cwd(),
        memoryUsage: process.memoryUsage(),
        detectionSignals: signals,
        runtimeProfile
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

    // Netlify 감지
    const netlifyFlag = env.NETLIFY === 'true' || !!env.NETLIFY_DEV;
    const hasNetlifyContext = !!env.CONTEXT;

    // Cloudflare 감지
    const cloudflareFlag = !!env.CF_PAGES || !!env.CF_PAGES_URL;

    // Railway 감지
    const railwayFlag = !!env.RAILWAY_ENVIRONMENT;

    // Render 감지
    const renderFlag = !!env.RENDER || !!env.IS_PULL_REQUEST;

    const tmpIsVercel = os.tmpdir() === '/tmp';
    const isLinux = process.platform === 'linux';
    const nodeEnv = env.NODE_ENV;
    const isDevelopment = nodeEnv === 'development' || env.DEV === 'true';

    if (vercelFlag) signals.push('VERCEL=1');
    if (hasVercelEnv) signals.push(`VERCEL_ENV=${env.VERCEL_ENV}`);
    if (hasVercelUrl) signals.push('VERCEL_URL');
    if (hasVercelRegion) signals.push(`REGION=${env.VERCEL_REGION}`);
    if (cwdIsVercel) signals.push('CWD=/var/task');
    if (netlifyFlag) signals.push('NETLIFY');
    if (hasNetlifyContext) signals.push(`CONTEXT=${env.CONTEXT}`);
    if (cloudflareFlag) signals.push('CF_PAGES');
    if (railwayFlag) signals.push('RAILWAY');
    if (renderFlag) signals.push('RENDER');
    if (tmpIsVercel && isLinux) signals.push('TMP=/tmp+Linux');
    if (isDevelopment) signals.push('NODE_ENV=development');

    // 플랫폼 판정
    let platform: ServerlessPlatform = 'unknown';
    const isVercel = vercelFlag || (hasVercelEnv && hasVercelUrl);
    const isNetlify = netlifyFlag || hasNetlifyContext;
    const isCloudflare = cloudflareFlag;
    const isRailway = railwayFlag;
    const isRender = renderFlag;

    if (isVercel) platform = 'vercel';
    else if (isNetlify) platform = 'netlify';
    else if (isCloudflare) platform = 'cloudflare';
    else if (isRailway) platform = 'railway';
    else if (isRender) platform = 'render';
    else if (isDevelopment || (!isLinux && !tmpIsVercel)) platform = 'local';

    const isProduction = env.VERCEL_ENV === 'production' ||
        env.CONTEXT === 'production' ||
        env.NODE_ENV === 'production';

    const runtimeProfile = { ...RUNTIME_PROFILES[platform] };
    runtimeProfile.tempDir = os.tmpdir();

    return {
        isVercel,
        isNetlify,
        isCloudflare,
        isRailway,
        isRender,
        isProduction,
        isDevelopment,
        platform,
        vercelEnv: env.VERCEL_ENV,
        vercelRegion: env.VERCEL_REGION,
        vercelUrl: env.VERCEL_URL,
        nodeEnv: env.NODE_ENV,
        osPlatform: process.platform,
        tmpDir: os.tmpdir(),
        cwd: process.cwd(),
        memoryUsage: process.memoryUsage(),
        detectionSignals: signals,
        runtimeProfile
    };
}

/**
 * 시스템 상태 로그 출력 (서버 시작 시 호출)
 */
export function logSystemStatus(): void {
    const env = detectEnvironment();
    const mem = env.memoryUsage;
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔧 JuJu System Status');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Platform: ${env.platform.toUpperCase()} ${env.isProduction ? '(Production)' : env.isDevelopment ? '(Development)' : ''}`);
    console.log(`  Signals:  [${env.detectionSignals.join(', ')}]`);
    console.log('');
    console.log('  Runtime Profile:');
    console.log(`    • Max Memory:    ${env.runtimeProfile.maxMemoryMB} MB`);
    console.log(`    • Max Timeout:   ${env.runtimeProfile.maxTimeoutSeconds} sec`);
    console.log(`    • Spawn Process: ${env.runtimeProfile.canSpawnProcess ? '✅ Allowed' : '❌ Disabled'}`);
    console.log(`    • Writable FS:   ${env.runtimeProfile.hasWritableFS ? '✅ Yes' : '⚠️ /tmp only'}`);
    console.log(`    • Recommended:   ${env.runtimeProfile.recommendedModel}`);
    console.log('');
    console.log('  Memory Usage:');
    console.log(`    • Heap Used:  ${heapUsedMB} MB`);
    console.log(`    • Heap Total: ${heapTotalMB} MB`);
    console.log(`    • RSS:        ${rssMB} MB`);
    console.log('');
    console.log(`  Temp Dir: ${env.tmpDir}`);
    console.log(`  CWD:      ${env.cwd}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
}

/**
 * 런타임 프로파일 가져오기
 */
export function getRuntimeProfile(): RuntimeProfile {
    return detectEnvironment().runtimeProfile;
}

