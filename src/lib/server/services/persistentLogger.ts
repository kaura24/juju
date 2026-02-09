/** File: src/lib/server/services/persistentLogger.ts */
/**
 * 지속성 로그 - Supabase Storage에 실행 로그 저장
 * Vercel 환경에서 디버깅용
 */

import { supabase } from './supabase_storage';

const LOG_FOLDER = 'debug-logs';

interface LogEntry {
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
    source: string;
    message: string;
    data?: any;
}

/**
 * 로그를 Supabase Storage에 저장
 */
export async function persistLog(
    level: LogEntry['level'],
    source: string,
    message: string,
    data?: any
): Promise<void> {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        data
    };

    const filename = `${LOG_FOLDER}/${Date.now()}_${level}.json`;

    try {
        const { error } = await supabase.storage
            .from('juju-data')
            .upload(filename, JSON.stringify(entry, null, 2), {
                contentType: 'application/json',
                upsert: false
            });

        if (error) {
            console.error('[PersistentLogger] Failed to save log:', error);
        }
    } catch (e) {
        console.error('[PersistentLogger] Error:', e);
    }
}

/**
 * 최근 로그 조회
 */
export async function getRecentLogs(limit: number = 50): Promise<LogEntry[]> {
    try {
        const { data: files, error } = await supabase.storage
            .from('juju-data')
            .list(LOG_FOLDER, { limit, sortBy: { column: 'created_at', order: 'desc' } });

        if (error || !files) return [];

        const logs: LogEntry[] = [];
        for (const file of files.slice(0, limit)) {
            const { data } = await supabase.storage
                .from('juju-data')
                .download(`${LOG_FOLDER}/${file.name}`);

            if (data) {
                const text = await data.text();
                try {
                    logs.push(JSON.parse(text));
                } catch { }
            }
        }

        return logs.sort((a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
    } catch (e) {
        console.error('[PersistentLogger] getRecentLogs error:', e);
        return [];
    }
}

/**
 * 모든 디버그 로그 삭제
 */
export async function clearDebugLogs(): Promise<number> {
    try {
        const { data: files, error } = await supabase.storage
            .from('juju-data')
            .list(LOG_FOLDER, { limit: 1000 });

        if (error || !files || files.length === 0) return 0;

        const paths = files.map(f => `${LOG_FOLDER}/${f.name}`);
        await supabase.storage.from('juju-data').remove(paths);

        return paths.length;
    } catch (e) {
        console.error('[PersistentLogger] clearDebugLogs error:', e);
        return 0;
    }
}
