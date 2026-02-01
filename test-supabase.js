// Supabase 연결 테스트 스크립트
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

console.log('🔍 Supabase 연결 테스트...\n');
console.log('URL:', supabaseUrl);
console.log('Key Type:', process.env.SUPABASE_SERVICE_KEY ? 'SERVICE_KEY ✓' : 'ANON_KEY (주의!)');

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSupabase() {
  try {
    // 1. 버킷 목록 확인
    console.log('\n📦 버킷 목록:');
    const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();

    if (bucketError) {
      console.error('❌ 버킷 조회 실패:', bucketError.message);
    } else {
      buckets.forEach(bucket => {
        console.log(`  - ${bucket.name} (Public: ${bucket.public})`);
      });
    }

    // 2. juju-data 버킷 파일 목록
    console.log('\n📁 juju-data 버킷 파일:');
    const { data: files, error: listError } = await supabase.storage
      .from('juju-data')
      .list('uploads', { limit: 10 });

    if (listError) {
      console.error('❌ 파일 조회 실패:', listError.message);
    } else {
      console.log(`  총 ${files.length}개 파일`);
      files.forEach(file => {
        console.log(`  - ${file.name}`);
      });
    }

    // 3. 테스트 업로드
    console.log('\n🧪 테스트 파일 업로드 시도...');
    const testContent = 'test content';
    const testPath = 'uploads/test-' + Date.now() + '.txt';

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('juju-data')
      .upload(testPath, testContent, {
        contentType: 'text/plain',
        upsert: true
      });

    if (uploadError) {
      console.error('❌ 업로드 실패:', uploadError.message);
      console.error('   상세:', JSON.stringify(uploadError, null, 2));
    } else {
      console.log('✅ 업로드 성공:', uploadData.path);

      // 업로드된 파일 삭제
      await supabase.storage.from('juju-data').remove([testPath]);
      console.log('🗑️  테스트 파일 삭제 완료');
    }

  } catch (error) {
    console.error('💥 예상치 못한 에러:', error);
  }
}

testSupabase();
