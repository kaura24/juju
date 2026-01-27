/** File: src/lib/server/services/supabase_storage.ts */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

// Supabase 클라이언트 초기화
const supabaseUrl = env.SUPABASE_URL || '';
const supabaseKey = env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('[SupabaseStorage] SUPABASE_URL or SUPABASE_ANON_KEY is missing in .env');
}

export const supabase = createClient(supabaseUrl, supabaseKey);

const BUCKET_NAME = 'juju-images-public'; // 실제 버킷 이름으로 변경됨

/**
 * 이미지를 Supabase Storage에 업로드합니다.
 */
export async function uploadImage(fileBuffer: Buffer, fileName: string, contentType: string = 'image/png') {
    try {
        const { data, error } = await supabase.storage
            .from(BUCKET_NAME)
            .upload(fileName, fileBuffer, {
                contentType,
                upsert: true
            });

        if (error) throw error;
        return data;
    } catch (error) {
        console.error('[SupabaseStorage] Upload Error:', error);
        throw error;
    }
}

/**
 * 업로드된 이미지의 Public URL을 가져옵니다.
 */
export function getPublicUrl(path: string) {
    const { data } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(path);

    return data.publicUrl;
}

/**
 * JSON 데이터를 Supabase Storage에 저장합니다.
 * (Bucket: juju-data)
 */
export async function uploadJson(path: string, data: any) {
    // path example: "runs/123.json"
    const jsonString = JSON.stringify(data, null, 2);
    const { error } = await supabase.storage
        .from('juju-data')
        .upload(path, jsonString, {
            contentType: 'application/json',
            upsert: true
        });

    if (error) {
        console.error(`[SupabaseStorage] Failed to upload JSON to ${path}:`, error);
        // Don't throw for minor errors, but here it's critical
        throw error;
    }
}

/**
 * Supabase Storage에서 JSON 데이터를 로드합니다.
 */
export async function downloadJson<T>(path: string): Promise<T | null> {
    const { data, error } = await supabase.storage
        .from('juju-data')
        .download(path);

    if (error) {
        // Console warn instead of error for missing files (common in first load)
        // console.warn(`[SupabaseStorage] Failed to download JSON from ${path}:`, error.message);
        return null;
    }

    const text = await data.text();
    try {
        return JSON.parse(text) as T;
    } catch (e) {
        console.error(`[SupabaseStorage] JSON Parse Error for ${path}:`, e);
        return null;
    }
}

/**
 * Supabase Storage의 특정 폴더 내 파일 목록을 가져옵니다.
 */
export async function listJsonFiles(folder: string): Promise<string[]> {
    const { data, error } = await supabase.storage
        .from('juju-data')
        .list(folder, {
            limit: 100,
            offset: 0,
            sortBy: { column: 'created_at', order: 'desc' },
        });

    if (error) {
        console.error(`[SupabaseStorage] List Error in ${folder}:`, error);
        return [];
    }

    return data.map(file => file.name);
}

/**
 * 일반 파일(PDF, Raw Image 등)을 Supabase Storage에 업로드합니다.
 * (Bucket: juju-data)
 */
export async function uploadRawFile(fileBuffer: Buffer, fileName: string, contentType: string) {
    const { data, error } = await supabase.storage
        .from('juju-data')
        .upload(fileName, fileBuffer, {
            contentType,
            upsert: true
        });

    if (error) {
        console.error(`[SupabaseStorage] Failed to upload Raw File to ${fileName}:`, error);
        throw error;
    }
}

/**
 * juju-data 버킷의 파일에 대한 Public URL을 가져옵니다.
 */
export function getRawFileUrl(path: string) {
    const { data } = supabase.storage
        .from('juju-data')
        .getPublicUrl(path);

    return data.publicUrl;
}
