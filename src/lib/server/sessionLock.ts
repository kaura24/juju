/** File: src/lib/server/sessionLock.ts */
/**
 * 세션 잠금 관리자
 * - 동시 처리 방지를 위한 단일 활성 런 잠금
 * - Supabase Storage에 잠금 상태 저장
 */

import { supabase } from './services/supabase_storage';

const LOCK_FILE = 'system/session-lock.json';

interface SessionLock {
    isLocked: boolean;
    currentRunId: string | null;
    lockedAt: string | null;
    lockedBy: string;
}

/**
 * 현재 잠금 상태 조회
 */
export async function getSessionLock(): Promise<SessionLock> {
    try {
        const { data, error } = await supabase.storage
            .from('juju-data')
            .download(LOCK_FILE);

        if (error || !data) {
            return { isLocked: false, currentRunId: null, lockedAt: null, lockedBy: '' };
        }

        const text = await data.text();
        return JSON.parse(text) as SessionLock;
    } catch {
        return { isLocked: false, currentRunId: null, lockedAt: null, lockedBy: '' };
    }
}

/**
 * 세션 잠금 획득 시도
 * @returns 잠금 성공 시 true, 이미 잠겨있으면 false
 */
export async function acquireSessionLock(runId: string): Promise<{ success: boolean; currentRunId?: string }> {
    const current = await getSessionLock();

    // 이미 잠겨있고, 5분 이내면 거부
    if (current.isLocked && current.lockedAt) {
        const lockAge = Date.now() - new Date(current.lockedAt).getTime();
        const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5분

        if (lockAge < LOCK_TIMEOUT_MS) {
            console.log(`[SessionLock] Lock denied - already locked by run ${current.currentRunId}`);
            return { success: false, currentRunId: current.currentRunId ?? undefined };
        }
        // 5분 이상 된 잠금은 만료로 간주
        console.log(`[SessionLock] Expired lock detected, overriding`);
    }

    // 새 잠금 설정
    const newLock: SessionLock = {
        isLocked: true,
        currentRunId: runId,
        lockedAt: new Date().toISOString(),
        lockedBy: 'system'
    };

    try {
        await supabase.storage
            .from('juju-data')
            .upload(LOCK_FILE, JSON.stringify(newLock), {
                contentType: 'application/json',
                upsert: true
            });

        console.log(`[SessionLock] Lock acquired for run ${runId}`);
        return { success: true };
    } catch (e) {
        console.error('[SessionLock] Failed to acquire lock:', e);
        return { success: false };
    }
}

/**
 * 세션 잠금 해제
 */
export async function releaseSessionLock(runId: string): Promise<void> {
    const current = await getSessionLock();

    // 다른 run이 잠금을 가지고 있으면 해제하지 않음
    if (current.currentRunId && current.currentRunId !== runId) {
        console.log(`[SessionLock] Cannot release - lock owned by ${current.currentRunId}, not ${runId}`);
        return;
    }

    const unlocked: SessionLock = {
        isLocked: false,
        currentRunId: null,
        lockedAt: null,
        lockedBy: ''
    };

    try {
        await supabase.storage
            .from('juju-data')
            .upload(LOCK_FILE, JSON.stringify(unlocked), {
                contentType: 'application/json',
                upsert: true
            });

        console.log(`[SessionLock] Lock released for run ${runId}`);
    } catch (e) {
        console.error('[SessionLock] Failed to release lock:', e);
    }
}

/**
 * 강제 잠금 해제 (관리용)
 */
export async function forceReleaseLock(): Promise<void> {
    const unlocked: SessionLock = {
        isLocked: false,
        currentRunId: null,
        lockedAt: null,
        lockedBy: ''
    };

    await supabase.storage
        .from('juju-data')
        .upload(LOCK_FILE, JSON.stringify(unlocked), {
            contentType: 'application/json',
            upsert: true
        });

    console.log(`[SessionLock] Force released`);
}
