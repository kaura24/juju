-- [사용 방법]
-- 1. Supabase 대시보드 -> SQL Editor 로 이동
-- 2. 새 쿼리 창에 아래 내용을 "몽땅 복사"해서 붙여넣기
-- 3. 우측 하단 "Run" 버튼 클릭

-- 1단계: 'juju-data' 버킷 준비
insert into storage.buckets (id, name, public) 
values ('juju-data', 'juju-data', true) 
on conflict (id) do nothing;

-- 2단계: 기존 충돌 정책 정리
drop policy if exists "Allow Public Access" on storage.objects;
drop policy if exists "Allow All" on storage.objects;
drop policy if exists "Allow Juju Data Access" on storage.objects;
drop policy if exists "Juju Strict Policy" on storage.objects;

-- 3단계: [보안] Role + 확장자 제한 정책 (사용자 요청 반영)
-- 주주명부 PDF/이미지 분석을 위해 PDF 확장자 추가
create policy "Juju Strict Policy"
on storage.objects for all
using (
  bucket_id = 'juju-data'
  AND (auth.role() = 'anon' OR auth.role() = 'service_role')  -- Service Role도 허용
  AND (
    storage.extension(name) = 'json'  -- JSON 허용 (필수)
    OR storage.extension(name) = 'png' -- PNG 허용
    OR storage.extension(name) = 'jpg' -- JPG 허용
    OR storage.extension(name) = 'jpeg' -- JPEG 허용
    OR storage.extension(name) = 'pdf' -- PDF 허용 (주주명부 분석)
  )
)
with check (
  bucket_id = 'juju-data'
  AND (auth.role() = 'anon' OR auth.role() = 'service_role')
  AND (
    storage.extension(name) = 'json'
    OR storage.extension(name) = 'png'
    OR storage.extension(name) = 'jpg'
    OR storage.extension(name) = 'jpeg'
    OR storage.extension(name) = 'pdf'
  )
);
