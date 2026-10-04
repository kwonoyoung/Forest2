-- Forest2 보안 정비 (2026-10-04)
-- 1) 등록 후 24시간이 지난 수목을 자동 삭제하던 체험판 로직 제거
-- 2) 수목·점검일지 편집(등록/수정/삭제)은 로그인 사용자만 가능
-- 3) 로그인하지 않은 QR 방문자는 공개 항목(명칭·대장번호·재산종목·사진·나무이야기·최근 점검상태)만 조회
-- 4) 사진·음원 업로드/삭제/목록조회는 로그인 사용자만 가능 (공개 URL로 열람은 유지)
-- 5) 누가 등록·수정했는지 기록(created_by / updated_by)

begin;

-- 1) 자동 삭제 제거 + 작성자 기록 ------------------------------------------
alter table public.demo_trees
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;
alter table public.demo_tree_management_logs
  add column if not exists created_by uuid default auth.uid() references auth.users(id) on delete set null,
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

create or replace function private.maintain_demo_trees()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  -- 작성자는 서버가 정합니다 (브라우저에서 보낸 값은 무시)
  if tg_op = 'INSERT' then
    new.created_by = auth.uid();
  else
    new.created_by = old.created_by;
  end if;
  return new;
end;
$$;

drop trigger if exists demo_tree_logs_maintenance on public.demo_tree_management_logs;
create trigger demo_tree_logs_maintenance
  before insert or update on public.demo_tree_management_logs
  for each row execute function private.maintain_demo_trees();

-- 2) 테이블 접근 규칙 -------------------------------------------------------
drop policy if exists demo_trees_public_read   on public.demo_trees;
drop policy if exists demo_trees_public_insert on public.demo_trees;
drop policy if exists demo_trees_public_update on public.demo_trees;
drop policy if exists demo_trees_public_delete on public.demo_trees;
drop policy if exists demo_tree_logs_public_read   on public.demo_tree_management_logs;
drop policy if exists demo_tree_logs_public_insert on public.demo_tree_management_logs;
drop policy if exists demo_tree_logs_public_update on public.demo_tree_management_logs;
drop policy if exists demo_tree_logs_public_delete on public.demo_tree_management_logs;

-- 로그인 사용자: 전체 조회·편집
create policy demo_trees_auth_select on public.demo_trees for select to authenticated using (true);
create policy demo_trees_auth_insert on public.demo_trees for insert to authenticated with check (true);
create policy demo_trees_auth_update on public.demo_trees for update to authenticated using (true) with check (true);
create policy demo_trees_auth_delete on public.demo_trees for delete to authenticated using (true);
create policy demo_tree_logs_auth_select on public.demo_tree_management_logs for select to authenticated using (true);
create policy demo_tree_logs_auth_insert on public.demo_tree_management_logs for insert to authenticated with check (true);
create policy demo_tree_logs_auth_update on public.demo_tree_management_logs for update to authenticated using (true) with check (true);
create policy demo_tree_logs_auth_delete on public.demo_tree_management_logs for delete to authenticated using (true);

-- 비로그인(anon): 행은 볼 수 있으나 공개 컬럼만 (컬럼 단위 권한)
create policy demo_trees_anon_public_select on public.demo_trees for select to anon using (true);
create policy demo_tree_logs_anon_public_select on public.demo_tree_management_logs for select to anon using (true);

revoke all on public.demo_trees, public.demo_tree_management_logs from anon;
grant select (id, asset_no, name, property_type, property_item, photo_url, audio_url, audio_name)
  on public.demo_trees to anon;
grant select (id, tree_id, inspection_date, inspection_status, created_at)
  on public.demo_tree_management_logs to anon;
revoke truncate, references, trigger on public.demo_trees, public.demo_tree_management_logs from authenticated;
grant select, insert, update, delete on public.demo_trees, public.demo_tree_management_logs to authenticated;

-- 사진·음원 주소는 이 프로젝트 저장소 주소만 허용 (외부 추적 이미지 등 차단). 기존 행은 검사하지 않음(not valid)
alter table public.demo_trees
  add constraint demo_trees_photo_url_storage check (photo_url is null or photo_url like 'https://jacvltitwrxyfoasjcwq.supabase.co/storage/v1/object/public/demo-tree-photos/%') not valid,
  add constraint demo_trees_location_photo_url_storage check (location_photo_url is null or location_photo_url like 'https://jacvltitwrxyfoasjcwq.supabase.co/storage/v1/object/public/demo-tree-photos/%') not valid,
  add constraint demo_trees_audio_url_storage check (audio_url is null or audio_url like 'https://jacvltitwrxyfoasjcwq.supabase.co/storage/v1/object/public/demo-tree-audio/%') not valid;
alter table public.demo_tree_management_logs
  add constraint demo_logs_state_photo_url_storage check (state_photo_url is null or state_photo_url like 'https://jacvltitwrxyfoasjcwq.supabase.co/storage/v1/object/public/demo-tree-photos/%') not valid;

-- 3) QR 공개용 뷰: 공개 항목만 -----------------------------------------------
drop view if exists public.demo_trees_public;
drop view if exists public.demo_tree_management_logs_public;

create view public.demo_trees_public with (security_invoker = true) as
  select id, asset_no, name, property_type, property_item, photo_url, audio_url, audio_name
  from public.demo_trees;

create view public.demo_tree_management_logs_public with (security_invoker = true) as
  select id, tree_id, inspection_date, inspection_status, created_at
  from public.demo_tree_management_logs;

revoke all on public.demo_trees_public, public.demo_tree_management_logs_public from anon, authenticated;
grant select on public.demo_trees_public, public.demo_tree_management_logs_public to anon, authenticated;

-- 4) 저장소(사진·음원) ------------------------------------------------------
drop policy if exists demo_tree_photos_public_insert on storage.objects;
drop policy if exists demo_tree_photos_public_update on storage.objects;
drop policy if exists demo_tree_photos_public_delete on storage.objects;
drop policy if exists demo_tree_audio_public_insert on storage.objects;
drop policy if exists demo_tree_audio_public_update on storage.objects;
drop policy if exists demo_tree_audio_public_delete on storage.objects;

-- 비로그인 방문자가 파일 목록을 조회하지 못하도록 공개 읽기 정책 제거
-- (공개 버킷이라 사진·음원 주소로 직접 여는 것은 그대로 됩니다)
drop policy if exists demo_tree_photos_public_read on storage.objects;
drop policy if exists demo_tree_audio_public_read on storage.objects;

create policy demo_tree_media_auth_select on storage.objects for select to authenticated
  using (bucket_id in ('demo-tree-photos', 'demo-tree-audio'));
create policy demo_tree_media_auth_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('demo-tree-photos', 'demo-tree-audio'));
create policy demo_tree_media_auth_update on storage.objects for update to authenticated
  using (bucket_id in ('demo-tree-photos', 'demo-tree-audio'))
  with check (bucket_id in ('demo-tree-photos', 'demo-tree-audio'));
create policy demo_tree_media_auth_delete on storage.objects for delete to authenticated
  using (bucket_id in ('demo-tree-photos', 'demo-tree-audio'));

commit;

-- 적용 후 확인용:
-- select policyname, roles, cmd from pg_policies where schemaname in ('public','storage') and (tablename like 'demo%' or tablename = 'objects') order by tablename, cmd;
