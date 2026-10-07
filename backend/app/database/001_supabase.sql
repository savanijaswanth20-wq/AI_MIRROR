-- AI SMART MIRROR document-backed domain schema, compatible with Supabase REST.
-- Run in the Supabase SQL editor once. Never place the service-role key in a browser.
begin;

do $$
declare entity text;
begin
  foreach entity in array array[
    'users','customers','products','categories','product_images','product_variants',
    'sizes','colors','inventory','stores','store_locations','mirror_stations',
    'try_on_sessions','try_on_products','recommendations','staff_requests',
    'carts','cart_items','orders','analytics_events','qr_transfers','settings'
  ] loop
    execute format('create table if not exists public.%I (
      id text primary key, payload jsonb not null check (jsonb_typeof(payload) = ''object''),
      updated_at timestamptz not null default now())', entity);
    execute format('alter table public.%I enable row level security', entity);
  end loop;
end $$;

-- Roles live in a server-controlled table, never editable JWT user_metadata.
create or replace function public.mirror_role() returns text
language sql stable security definer set search_path = public
as $$ select payload->>'role' from public.users where id = auth.uid()::text $$;
revoke all on function public.mirror_role() from public;
grant execute on function public.mirror_role() to authenticated;

do $$
declare entity text;
begin
  foreach entity in array array[
    'users','customers','products','categories','product_images','product_variants',
    'sizes','colors','inventory','stores','store_locations','mirror_stations',
    'try_on_sessions','try_on_products','recommendations','staff_requests',
    'carts','cart_items','orders','analytics_events','qr_transfers','settings'
  ] loop
    execute format('drop policy if exists admin_all on public.%I', entity);
    execute format('create policy admin_all on public.%I for all to authenticated
      using (public.mirror_role() = ''admin'') with check (public.mirror_role() = ''admin'')', entity);
    execute format('grant select, insert, update, delete on public.%I to authenticated', entity);
    execute format('grant all on public.%I to service_role', entity);
  end loop;
  foreach entity in array array['products','categories','product_images','product_variants',
                                'sizes','colors','stores','store_locations'] loop
    execute format('drop policy if exists catalogue_read on public.%I', entity);
    execute format('create policy catalogue_read on public.%I for select to anon, authenticated using (true)', entity);
    execute format('grant select on public.%I to anon', entity);
  end loop;
end $$;

drop policy if exists own_user_read on public.users;
create policy own_user_read on public.users for select to authenticated using (id = auth.uid()::text);
drop policy if exists staff_read on public.staff_requests;
create policy staff_read on public.staff_requests for select to authenticated using (public.mirror_role() = 'staff');
drop policy if exists staff_update on public.staff_requests;
create policy staff_update on public.staff_requests for update to authenticated
  using (public.mirror_role() = 'staff') with check (public.mirror_role() = 'staff');

-- Direct authenticated staff writes may only advance status one step.
create or replace function public.guard_staff_transition() returns trigger
language plpgsql set search_path = public as $$
declare stages text[] := array['Waiting','Accepted','Bringing Product','Completed'];
begin
  if auth.role() = 'authenticated' and public.mirror_role() = 'staff' then
    if (new.payload - 'status' - 'updatedAt') is distinct from (old.payload - 'status' - 'updatedAt') then
      raise exception 'Staff may only change fulfilment status';
    end if;
    if array_position(stages, new.payload->>'status') is null or
       array_position(stages, new.payload->>'status') not in
       (array_position(stages, old.payload->>'status'), array_position(stages, old.payload->>'status') + 1) then
      raise exception 'Invalid fulfilment transition';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists guard_staff_transition on public.staff_requests;
create trigger guard_staff_transition before update on public.staff_requests
  for each row execute function public.guard_staff_transition();

create index if not exists analytics_type_idx on public.analytics_events ((payload->>'type'));
create index if not exists analytics_timestamp_idx on public.analytics_events ((payload->>'timestamp'));
create index if not exists cart_session_idx on public.cart_items ((payload->>'sessionId'));
create index if not exists session_expiry_idx on public.try_on_sessions ((payload->>'expiresAt'));
create index if not exists transfer_expiry_idx on public.qr_transfers ((payload->>'expiresAt'));

-- Backend batches related mutations into one database transaction. Access is
-- exclusively service_role; browser users cannot invoke arbitrary table writes.
create or replace function public.mirror_apply_operations(operations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare operation jsonb; entity text;
begin
  if jsonb_typeof(operations) <> 'array' or jsonb_array_length(operations) > 1000 then
    raise exception 'Invalid transaction batch';
  end if;
  for operation in select value from jsonb_array_elements(operations) loop
    entity := operation->>'table_name';
    if entity not in ('users','customers','products','categories','product_images','product_variants',
      'sizes','colors','inventory','stores','store_locations','mirror_stations','try_on_sessions',
      'try_on_products','recommendations','staff_requests','carts','cart_items','orders',
      'analytics_events','qr_transfers','settings') then
      raise exception 'Unknown domain table';
    end if;
    if (operation->>'is_delete')::boolean then
      execute format('delete from public.%I where id = $1', entity) using operation->>'id';
    else
      execute format('insert into public.%I(id,payload) values($1,$2)
        on conflict(id) do update set payload=excluded.payload, updated_at=now()', entity)
        using operation->>'id', operation->'payload';
    end if;
  end loop;
end $$;
revoke all on function public.mirror_apply_operations(jsonb) from public, anon, authenticated;
grant execute on function public.mirror_apply_operations(jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('garment-assets','garment-assets',true,5242880,array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                             allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists garment_public_read on storage.objects;
create policy garment_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'garment-assets');
drop policy if exists garment_admin_write on storage.objects;
create policy garment_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'garment-assets' and public.mirror_role() = 'admin')
  with check (bucket_id = 'garment-assets' and public.mirror_role() = 'admin');

-- Bootstrap an administrator AFTER creating its Supabase Auth account:
-- insert into public.users(id,payload) values ('AUTH-USER-UUID',
--   jsonb_build_object('id','AUTH-USER-UUID','role','admin'));
-- Anonymous carts/sessions/transfers deliberately have no client-side RLS grants;
-- the backend verifies their unguessable session bearer and applies expiry.
commit;
