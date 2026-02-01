-- 1. 버킷이 없다면 생성 (SQL로 생성 시)
insert into storage.buckets (id, name, public)
values ('juju-data', 'juju-data', true)
on conflict (id) do nothing;

-- 2. "juju-data" 버킷에 대한 조회(SELECT) 권한 개방
create policy "Public Access (Select)"
  on storage.objects for select
  using ( bucket_id = 'juju-data' );

-- 3. "juju-data" 버킷에 대한 업로드(INSERT) 권한 개방 (모든 익명 사용자)
create policy "Public Access (Insert)"
  on storage.objects for insert
  with check ( bucket_id = 'juju-data' );

-- 4. "juju-data" 버킷에 대한 수정(UPDATE) 권한 개방
create policy "Public Access (Update)"
  on storage.objects for update
  using ( bucket_id = 'juju-data' );

-- 5. "juju-data" 버킷에 대한 삭제(DELETE) 권한 개방 (선택사항)
create policy "Public Access (Delete)"
  on storage.objects for delete
  using ( bucket_id = 'juju-data' );
