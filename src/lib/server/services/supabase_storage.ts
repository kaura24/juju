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
