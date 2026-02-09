/** File: src/lib/server/services/supabase_storage.ts */
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

// Supabase 클라이언트 초기화
// Vercel 서버리스 환경에서는 RLS 제약 없이 작동하는 SERVICE_KEY 사용
const supabaseUrl = env.SUPABASE_URL || '';
const supabaseKey = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.warn('[SupabaseStorage] SUPABASE_URL or SUPABASE_SERVICE_KEY is missing in .env');
}

if (!env.SUPABASE_SERVICE_KEY) {
    console.warn('[SupabaseStorage] WARNING: Using ANON_KEY instead of SERVICE_KEY. This may cause RLS permission errors in production.');
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
        console.log(`[SupabaseStorage] Image uploaded: ${BUCKET_NAME}/${fileName}`);
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
    console.log(`[SupabaseStorage] JSON uploaded: juju-data/${path}`);
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
        console.log(`[SupabaseStorage] JSON downloaded: juju-data/${path}`);
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

    console.log(`[SupabaseStorage] JSON list: juju-data/${folder} (${data.length} files)`);
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
    console.log(`[SupabaseStorage] Raw file uploaded: juju-data/${fileName}`);
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

/**
 * 특정 폴더 내의 모든 파일을 삭제합니다.
 * @param folder 삭제할 폴더 (예: 'runs', 'events')
 * @returns 삭제된 파일 수
 */
export async function deleteAllInFolder(folder: string): Promise<number> {
    try {
        // 먼저 폴더 내 파일 목록 가져오기
        const { data: files, error: listError } = await supabase.storage
            .from('juju-data')
            .list(folder, { limit: 1000 });

        if (listError) {
            console.error(`[SupabaseStorage] List Error in ${folder}:`, listError);
            return 0;
        }

        if (!files || files.length === 0) {
            console.log(`[SupabaseStorage] No files in ${folder}`);
            return 0;
        }

        // 파일들 삭제
        const filePaths = files.map(file => `${folder}/${file.name}`);
        const { error: deleteError } = await supabase.storage
            .from('juju-data')
            .remove(filePaths);

        if (deleteError) {
            console.error(`[SupabaseStorage] Delete Error in ${folder}:`, deleteError);
            return 0;
        }

        console.log(`[SupabaseStorage] Deleted ${filePaths.length} files from ${folder}`);
        return filePaths.length;
    } catch (e) {
        console.error(`[SupabaseStorage] deleteAllInFolder error:`, e);
        return 0;
    }
}

/**
 * uploads 폴더의 모든 파일을 삭제합니다.
 * @returns 삭제된 파일 수
 */
export async function deleteAllUploads(): Promise<number> {
    return await deleteAllInFolder('uploads');
}

