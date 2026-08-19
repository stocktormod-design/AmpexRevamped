


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_role" AS ENUM (
    'owner',
    'admin',
    'bas',
    'installator',
    'montor',
    'laerling',
    'regnskapsforer'
);


ALTER TYPE "public"."app_role" OWNER TO "postgres";


CREATE TYPE "public"."order_status" AS ENUM (
    'mottatt',
    'planlagt',
    'pagaar',
    'fakturaklar',
    'fakturert'
);


ALTER TYPE "public"."order_status" OWNER TO "postgres";


CREATE TYPE "public"."scan_job_status" AS ENUM (
    'queued',
    'running',
    'done',
    'failed',
    'cancelled'
);


ALTER TYPE "public"."scan_job_status" OWNER TO "postgres";


CREATE TYPE "public"."scan_worker_status" AS ENUM (
    'online',
    'paused',
    'offline'
);


ALTER TYPE "public"."scan_worker_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_watermelon_pull_core"("_cutoff" timestamp with time zone, "_now_ms" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  o_c jsonb; o_u jsonb; o_d jsonb; doc_c jsonb; doc_u jsonb; doc_d jsonb;
  mat_c jsonb; mat_u jsonb; mat_d jsonb; p_c jsonb; p_u jsonb; p_d jsonb;
  l_c jsonb; l_u jsonb; l_d jsonb; mv_c jsonb; mv_u jsonb; mv_d jsonb;
  pr_c jsonb; pr_u jsonb; pr_d jsonb; dw_c jsonb; dw_u jsonb; dw_d jsonb;
begin
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into o_c from (
    select jsonb_build_object('id',id,'order_number',order_number,'title',title,'description',description,
      'customer_name',customer_name,'customer_phone',customer_phone,'address',address,'status',status::text,
      'assigned_to',assigned_to,'scheduled_at',(extract(epoch from scheduled_at)*1000)::bigint,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from orders where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into o_u from (
    select jsonb_build_object('id',id,'order_number',order_number,'title',title,'description',description,
      'customer_name',customer_name,'customer_phone',customer_phone,'address',address,'status',status::text,
      'assigned_to',assigned_to,'scheduled_at',(extract(epoch from scheduled_at)*1000)::bigint,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from orders where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into o_d from orders where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into doc_c from (
    select jsonb_build_object('id',id,'order_id',order_id,'template_id',template_id,'template_version',template_version,
      'status',status,'data',data,'completed_by',completed_by,'completed_at',(extract(epoch from completed_at)*1000)::bigint,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from order_documents where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into doc_u from (
    select jsonb_build_object('id',id,'order_id',order_id,'template_id',template_id,'template_version',template_version,
      'status',status,'data',data,'completed_by',completed_by,'completed_at',(extract(epoch from completed_at)*1000)::bigint,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from order_documents where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into doc_d from order_documents where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into mat_c from (
    select jsonb_build_object('id',id,'order_id',order_id,'elnummer',elnummer,'description',description,'quantity',quantity,'unit',unit,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from order_materials where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into mat_u from (
    select jsonb_build_object('id',id,'order_id',order_id,'elnummer',elnummer,'description',description,'quantity',quantity,'unit',unit,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from order_materials where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into mat_d from order_materials where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into p_c from (
    select jsonb_build_object('id',id,'elnummer',elnummer,'name',name,'unit',unit,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from products where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into p_u from (
    select jsonb_build_object('id',id,'elnummer',elnummer,'name',name,'unit',unit,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from products where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into p_d from products where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into l_c from (
    select jsonb_build_object('id',id,'type',type,'name',name,'assigned_to',assigned_to,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from locations where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into l_u from (
    select jsonb_build_object('id',id,'type',type,'name',name,'assigned_to',assigned_to,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from locations where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into l_d from locations where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into mv_c from (
    select jsonb_build_object('id',id,'product_id',product_id,'location_id',location_id,'quantity',quantity,'kind',kind,
      'order_id',order_id,'note',note,'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from stock_movements where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into mv_u from (
    select jsonb_build_object('id',id,'product_id',product_id,'location_id',location_id,'quantity',quantity,'kind',kind,
      'order_id',order_id,'note',note,'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from stock_movements where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into mv_d from stock_movements where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into pr_c from (
    select jsonb_build_object('id',id,'name',name,'customer_name',customer_name,'address',address,'status',status,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from projects where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into pr_u from (
    select jsonb_build_object('id',id,'name',name,'customer_name',customer_name,'address',address,'status',status,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from projects where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into pr_d from projects where deleted_at is not null and deleted_at > _cutoff;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into dw_c from (
    select jsonb_build_object('id',id,'project_id',project_id,'plan',plan,'discipline',discipline,'name',name,
      'file_path',file_path,'page_count',page_count,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from drawings where deleted_at is null and created_at > _cutoff) x;
  select coalesce(jsonb_agg(row_j),'[]'::jsonb) into dw_u from (
    select jsonb_build_object('id',id,'project_id',project_id,'plan',plan,'discipline',discipline,'name',name,
      'file_path',file_path,'page_count',page_count,
      'created_at',(extract(epoch from created_at)*1000)::bigint,'updated_at',(extract(epoch from updated_at)*1000)::bigint) row_j
    from drawings where deleted_at is null and updated_at > _cutoff and created_at <= _cutoff) x;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into dw_d from drawings where deleted_at is not null and deleted_at > _cutoff;

  return jsonb_build_object('changes', jsonb_build_object(
    'orders', jsonb_build_object('created',o_c,'updated',o_u,'deleted',o_d),
    'order_documents', jsonb_build_object('created',doc_c,'updated',doc_u,'deleted',doc_d),
    'order_materials', jsonb_build_object('created',mat_c,'updated',mat_u,'deleted',mat_d),
    'products', jsonb_build_object('created',p_c,'updated',p_u,'deleted',p_d),
    'locations', jsonb_build_object('created',l_c,'updated',l_u,'deleted',l_d),
    'stock_movements', jsonb_build_object('created',mv_c,'updated',mv_u,'deleted',mv_d),
    'projects', jsonb_build_object('created',pr_c,'updated',pr_u,'deleted',pr_d),
    'drawings', jsonb_build_object('created',dw_c,'updated',dw_u,'deleted',dw_d)
  ), 'timestamp', _now_ms);
end $$;


ALTER FUNCTION "public"."_watermelon_pull_core"("_cutoff" timestamp with time zone, "_now_ms" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_watermelon_push_core"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'orders'->'created','[]'::jsonb) || coalesce(changes->'orders'->'updated','[]'::jsonb)) loop
    insert into orders (id,company_id,title,description,customer_name,customer_phone,address,status,assigned_to,scheduled_at,created_by)
    values ((r->>'id')::uuid,_cid,coalesce(r->>'title',''),r->>'description',r->>'customer_name',r->>'customer_phone',r->>'address',
      coalesce(nullif(r->>'status',''),'mottatt')::public.order_status,nullif(r->>'assigned_to','')::uuid,
      case when (r->>'scheduled_at') is null then null else to_timestamp((r->>'scheduled_at')::bigint/1000.0) end,auth.uid())
    on conflict (id) do update set title=excluded.title,description=excluded.description,customer_name=excluded.customer_name,
      customer_phone=excluded.customer_phone,address=excluded.address,status=excluded.status,assigned_to=excluded.assigned_to,
      scheduled_at=excluded.scheduled_at where orders.company_id=_cid;
  end loop;
  update orders set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'orders'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'order_documents'->'created','[]'::jsonb) || coalesce(changes->'order_documents'->'updated','[]'::jsonb)) loop
    insert into order_documents (id,company_id,order_id,template_id,template_version,status,data,completed_by,completed_at,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'order_id')::uuid,coalesce(r->>'template_id',''),coalesce((r->>'template_version')::int,1),
      coalesce(nullif(r->>'status',''),'utkast'),r->>'data',nullif(r->>'completed_by','')::uuid,
      case when (r->>'completed_at') is null then null else to_timestamp((r->>'completed_at')::bigint/1000.0) end,auth.uid())
    on conflict (id) do update set status=excluded.status,data=excluded.data,completed_by=excluded.completed_by,
      completed_at=excluded.completed_at where order_documents.company_id=_cid;
  end loop;
  update order_documents set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'order_documents'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'order_materials'->'created','[]'::jsonb) || coalesce(changes->'order_materials'->'updated','[]'::jsonb)) loop
    insert into order_materials (id,company_id,order_id,elnummer,description,quantity,unit,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'order_id')::uuid,nullif(r->>'elnummer',''),coalesce(r->>'description',''),
      coalesce((r->>'quantity')::numeric,0),coalesce(nullif(r->>'unit',''),'stk'),auth.uid())
    on conflict (id) do update set elnummer=excluded.elnummer,description=excluded.description,quantity=excluded.quantity,
      unit=excluded.unit where order_materials.company_id=_cid;
  end loop;
  update order_materials set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'order_materials'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'products'->'created','[]'::jsonb) || coalesce(changes->'products'->'updated','[]'::jsonb)) loop
    insert into products (id,company_id,elnummer,name,unit,created_by)
    values ((r->>'id')::uuid,_cid,nullif(r->>'elnummer',''),coalesce(r->>'name',''),coalesce(nullif(r->>'unit',''),'stk'),auth.uid())
    on conflict (id) do update set elnummer=excluded.elnummer,name=excluded.name,unit=excluded.unit where products.company_id=_cid;
  end loop;
  update products set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'products'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'locations'->'created','[]'::jsonb) || coalesce(changes->'locations'->'updated','[]'::jsonb)) loop
    insert into locations (id,company_id,type,name,assigned_to,created_by)
    values ((r->>'id')::uuid,_cid,coalesce(nullif(r->>'type',''),'bil'),coalesce(r->>'name',''),nullif(r->>'assigned_to','')::uuid,auth.uid())
    on conflict (id) do update set type=excluded.type,name=excluded.name,assigned_to=excluded.assigned_to where locations.company_id=_cid;
  end loop;
  update locations set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'locations'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'stock_movements'->'created','[]'::jsonb) || coalesce(changes->'stock_movements'->'updated','[]'::jsonb)) loop
    insert into stock_movements (id,company_id,product_id,location_id,quantity,kind,order_id,note,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'product_id')::uuid,(r->>'location_id')::uuid,coalesce((r->>'quantity')::numeric,0),
      coalesce(nullif(r->>'kind',''),'justering'),nullif(r->>'order_id','')::uuid,r->>'note',auth.uid())
    on conflict (id) do update set quantity=excluded.quantity,kind=excluded.kind,order_id=excluded.order_id,note=excluded.note
      where stock_movements.company_id=_cid;
  end loop;
  update stock_movements set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'stock_movements'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'projects'->'created','[]'::jsonb) || coalesce(changes->'projects'->'updated','[]'::jsonb)) loop
    insert into projects (id,company_id,name,customer_name,address,status,created_by)
    values ((r->>'id')::uuid,_cid,coalesce(r->>'name',''),r->>'customer_name',r->>'address',
      coalesce(nullif(r->>'status',''),'aktiv'),auth.uid())
    on conflict (id) do update set name=excluded.name,customer_name=excluded.customer_name,address=excluded.address,
      status=excluded.status where projects.company_id=_cid;
  end loop;
  update projects set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'projects'->'deleted','[]'::jsonb)));

  for r in select * from jsonb_array_elements(coalesce(changes->'drawings'->'created','[]'::jsonb) || coalesce(changes->'drawings'->'updated','[]'::jsonb)) loop
    insert into drawings (id,company_id,project_id,plan,discipline,name,file_path,page_count,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'project_id')::uuid,coalesce(r->>'plan',''),coalesce(nullif(r->>'discipline',''),'elkraft'),
      coalesce(r->>'name',''),nullif(r->>'file_path',''),(r->>'page_count')::int,auth.uid())
    on conflict (id) do update set plan=excluded.plan,discipline=excluded.discipline,name=excluded.name,
      file_path=excluded.file_path,page_count=excluded.page_count where drawings.company_id=_cid;
  end loop;
  update drawings set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'drawings'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."_watermelon_push_core"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."assign_order_number"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.order_number is null then
    perform pg_advisory_xact_lock(hashtext('order_number:' || new.company_id::text));
    select coalesce(max(order_number), 0) + 1
      into new.order_number
      from public.orders
     where company_id = new.company_id;
  end if;
  return new;
end $$;


ALTER FUNCTION "public"."assign_order_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_company_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select company_id from public.profiles where id = auth.uid()
$$;


ALTER FUNCTION "public"."current_company_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_ai_key"("p_company_id" "uuid", "p_provider" "text" DEFAULT 'gemini'::"text") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'ai_' || p_provider || '_key_' || p_company_id::text
  limit 1
$$;


ALTER FUNCTION "public"."get_company_ai_key"("p_company_id" "uuid", "p_provider" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."scan_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "room_id" "uuid",
    "created_by" "uuid",
    "bundle_key" "text" NOT NULL,
    "frame_count" integer DEFAULT 0 NOT NULL,
    "bundle_bytes" bigint DEFAULT 0 NOT NULL,
    "est_vram_mb" integer DEFAULT 4096 NOT NULL,
    "status" "public"."scan_job_status" DEFAULT 'queued'::"public"."scan_job_status" NOT NULL,
    "priority" integer DEFAULT 0 NOT NULL,
    "claimed_by" "uuid",
    "lease_expires_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "progress" integer DEFAULT 0 NOT NULL,
    "stage" "text" DEFAULT ''::"text" NOT NULL,
    "result_key" "text",
    "error" "text",
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."scan_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_claim_job"("p_worker" "uuid") RETURNS "public"."scan_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_company uuid;
  v_vram integer;
  v_job public.scan_jobs;
begin
  select company_id, vram_mb into v_company, v_vram
    from public.scan_workers
   where id = p_worker and deleted_at is null;

  if v_company is null then
    raise exception 'ukjent worker';
  end if;

  -- Firmagrensen. security definer omgår RLS, så den må sjekkes eksplisitt her.
  if v_company is distinct from public.current_company_id() then
    raise exception 'worker tilhorer et annet firma';
  end if;

  update public.scan_jobs j
     set status           = 'running',
         claimed_by       = p_worker,
         lease_expires_at = now() + interval '3 minutes',
         attempts         = j.attempts + 1,
         started_at       = coalesce(j.started_at, now())
   where j.id = (
         select q.id
           from public.scan_jobs q
          where q.company_id  = v_company
            and q.deleted_at is null
            and q.status      = 'queued'
            and q.est_vram_mb <= v_vram
          order by q.priority desc, q.created_at
          limit 1
          for update skip locked
       )
   returning j.* into v_job;

  return v_job;
end $$;


ALTER FUNCTION "public"."scan_claim_job"("p_worker" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_complete"("p_job" "uuid", "p_result_key" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.scan_jobs
     set status = 'done', progress = 100, stage = '',
         result_key = p_result_key, error = null,
         lease_expires_at = null, finished_at = now()
   where id = p_job
     and company_id = public.current_company_id()
     and status = 'running';
$$;


ALTER FUNCTION "public"."scan_complete"("p_job" "uuid", "p_result_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_fail"("p_job" "uuid", "p_error" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.scan_jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed'::public.scan_job_status
                       else 'queued'::public.scan_job_status end,
         error  = p_error,
         claimed_by = null,
         lease_expires_at = null,
         stage = '', progress = 0,
         finished_at = case when j.attempts >= j.max_attempts then now() end
   where j.id = p_job
     and j.company_id = public.current_company_id()
     and j.status = 'running';
$$;


ALTER FUNCTION "public"."scan_fail"("p_job" "uuid", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_heartbeat"("p_job" "uuid", "p_progress" integer, "p_stage" "text") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  update public.scan_jobs
     set progress         = greatest(0, least(100, p_progress)),
         stage            = p_stage,
         lease_expires_at = now() + interval '3 minutes'
   where id = p_job
     and company_id = public.current_company_id()
     and status = 'running';
$$;


ALTER FUNCTION "public"."scan_heartbeat"("p_job" "uuid", "p_progress" integer, "p_stage" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."scan_requeue_expired"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_count integer;
begin
  update public.scan_jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed'::public.scan_job_status
                       else 'queued'::public.scan_job_status end,
         claimed_by = null,
         lease_expires_at = null,
         stage = '', progress = 0,
         error = coalesce(j.error, 'worker svarte ikke - lease utlopt')
   where j.company_id = public.current_company_id()
     and j.status = 'running'
     and j.lease_expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;


ALTER FUNCTION "public"."scan_requeue_expired"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_company_ai_key"("p_company_id" "uuid", "p_key" "text", "p_provider" "text" DEFAULT 'gemini'::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'vault'
    AS $$
declare
  _name text := 'ai_' || p_provider || '_key_' || p_company_id::text;
  _existing uuid;
begin
  select id into _existing from vault.secrets where name = _name;
  if _existing is not null then
    perform vault.update_secret(_existing, p_key);
  else
    perform vault.create_secret(p_key, _name);
  end if;
end $$;


ALTER FUNCTION "public"."set_company_ai_key"("p_company_id" "uuid", "p_key" "text", "p_provider" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_hidden_columns"() RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    AS $$ select array['company_id', 'deleted_at'] $$;


ALTER FUNCTION "public"."sync_hidden_columns"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_payload_in"("_table" "text", "r" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare c record; v jsonb; ut jsonb := r;
begin
  for c in select * from public.sync_pull_columns(_table)
           where data_type = 'timestamp with time zone' loop
    v := ut -> c.column_name;
    if v is not null and jsonb_typeof(v) = 'number' then
      ut := jsonb_set(ut, array[c.column_name],
                      to_jsonb(to_timestamp((v #>> '{}')::numeric / 1000.0)));
    end if;
  end loop;
  return (ut - 'deleted_at') || jsonb_build_object(
    'company_id', to_jsonb(public.current_company_id()),
    'created_by', to_jsonb(auth.uid()),
    'updated_at', to_jsonb(now()));
end $$;


ALTER FUNCTION "public"."sync_payload_in"("_table" "text", "r" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pull_columns"("_table" "text") RETURNS TABLE("column_name" "text", "data_type" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select c.column_name::text, c.data_type::text
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = _table
    and not (c.column_name = any (public.sync_hidden_columns()))
  order by c.ordinal_position
$$;


ALTER FUNCTION "public"."sync_pull_columns"("_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_pull_expr"("_table" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare c record; deler text[] := '{}';
begin
  for c in select * from public.sync_pull_columns(_table) loop
    deler := deler || format('%L', c.column_name);
    if c.data_type = 'timestamp with time zone' then
      deler := deler || format('(extract(epoch from x.%I) * 1000)::bigint', c.column_name);
    elsif c.data_type = 'USER-DEFINED' then
      deler := deler || format('x.%I::text', c.column_name);
    else
      deler := deler || format('x.%I', c.column_name);
    end if;
  end loop;
  return 'jsonb_build_object(' || array_to_string(deler, ', ') || ')';
end $$;


ALTER FUNCTION "public"."sync_pull_expr"("_table" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at := now();
  return new;
end $$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_pull"("last_pulled_at" bigint DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $_$
declare
  _now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  _cutoff timestamptz := to_timestamp(last_pulled_at / 1000.0);
  _changes jsonb := '{}'::jsonb;
  _created jsonb; _updated jsonb; _deleted jsonb; _expr text; t record;
begin
  for t in select table_name from public.sync_tables order by table_name loop
    _expr := public.sync_pull_expr(t.table_name);
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.created_at > $1', _expr, t.table_name)
      into _created using _cutoff;
    execute format(
      'select coalesce(jsonb_agg(%s), ''[]''::jsonb) from public.%I x
       where x.deleted_at is null and x.updated_at > $1 and x.created_at <= $1', _expr, t.table_name)
      into _updated using _cutoff;
    execute format(
      'select coalesce(jsonb_agg(x.id), ''[]''::jsonb) from public.%I x
       where x.deleted_at is not null and x.deleted_at > $1', t.table_name)
      into _deleted using _cutoff;
    _changes := _changes || jsonb_build_object(t.table_name,
      jsonb_build_object('created', _created, 'updated', _updated, 'deleted', _deleted));
  end loop;
  return jsonb_build_object('changes', _changes, 'timestamp', _now_ms);
end $_$;


ALTER FUNCTION "public"."watermelon_pull"("last_pulled_at" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push"("changes" "jsonb", "last_pulled_at" bigint DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
declare
  t record; r jsonb; payload jsonb;
  cols text[]; ins_cols text[]; sel_cols text[]; sett text[]; ider text[]; k text;
  truffet int;
begin
  for t in select table_name, no_update from public.sync_tables order by push_order, table_name loop
    if changes -> t.table_name is null then continue; end if;

    for r in select * from jsonb_array_elements(
      coalesce(changes -> t.table_name -> 'created', '[]'::jsonb) ||
      coalesce(changes -> t.table_name -> 'updated', '[]'::jsonb)) loop

      payload := public.sync_payload_in(t.table_name, r);

      select coalesce(array_agg(c.column_name::text order by c.ordinal_position), '{}')
        into cols from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = t.table_name
         and c.column_name in (select jsonb_object_keys(payload));

      ins_cols := '{}'; sel_cols := '{}'; sett := '{}';
      foreach k in array cols loop
        ins_cols := ins_cols || format('%I', k);
        sel_cols := sel_cols || format('r.%I', k);
        if k in ('id', 'created_at', 'company_id', 'created_by') then continue; end if;
        if k = any (t.no_update) then continue; end if;
        sett := sett || format('%1$I = r.%1$I', k);
      end loop;

      truffet := 0;
      if array_length(sett, 1) is not null then
        execute format(
          'update public.%1$I dst set %2$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           where dst.id = r.id and dst.company_id = public.current_company_id()',
          t.table_name, array_to_string(sett, ', ')) using payload;
        get diagnostics truffet = row_count;
      end if;

      if truffet = 0 then
        execute format(
          'insert into public.%1$I (%2$s) select %3$s
           from jsonb_populate_record(null::public.%1$I, $1) r
           on conflict (id) do nothing',
          t.table_name, array_to_string(ins_cols, ', '), array_to_string(sel_cols, ', '))
        using payload;
      end if;
    end loop;

    select coalesce(array_agg(value), '{}') into ider
      from jsonb_array_elements_text(coalesce(changes -> t.table_name -> 'deleted', '[]'::jsonb));

    if array_length(ider, 1) > 0 then
      execute format(
        'update public.%I set deleted_at = now()
         where deleted_at is null and company_id = public.current_company_id()
           and id = any ($1::uuid[])', t.table_name) using ider;
    end if;
  end loop;
end $_$;


ALTER FUNCTION "public"."watermelon_push"("changes" "jsonb", "last_pulled_at" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_form_comments"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'form_comments'->'created','[]'::jsonb) || coalesce(changes->'form_comments'->'updated','[]'::jsonb)) loop
    insert into form_comments (id,company_id,template_id,field_id,version,body,author_name,resolved,resolved_revision,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'template_id')::uuid,nullif(r->>'field_id',''),(r->>'version')::int,
      coalesce(r->>'body',''),nullif(r->>'author_name',''),coalesce((r->>'resolved')::boolean,false),(r->>'resolved_revision')::int,auth.uid())
    on conflict (id) do update set body=excluded.body,resolved=excluded.resolved,resolved_revision=excluded.resolved_revision
      where form_comments.company_id=_cid;
  end loop;
  update form_comments set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'form_comments'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_form_comments"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_form_revisions"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'form_template_revisions'->'created','[]'::jsonb) || coalesce(changes->'form_template_revisions'->'updated','[]'::jsonb)) loop
    insert into form_template_revisions (id,company_id,template_id,version,schema,change_note,changed_by)
    values ((r->>'id')::uuid,_cid,(r->>'template_id')::uuid,coalesce((r->>'version')::int,1),r->>'schema',r->>'change_note',auth.uid())
    on conflict (id) do update set schema=excluded.schema,change_note=excluded.change_note where form_template_revisions.company_id=_cid;
  end loop;
  update form_template_revisions set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'form_template_revisions'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_form_revisions"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_form_templates"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'form_templates'->'created','[]'::jsonb) || coalesce(changes->'form_templates'->'updated','[]'::jsonb)) loop
    insert into form_templates (id,company_id,key,title,category,current_version,status,created_by)
    values ((r->>'id')::uuid,_cid,nullif(r->>'key',''),coalesce(r->>'title',''),coalesce(nullif(r->>'category',''),'Diverse'),
      coalesce((r->>'current_version')::int,1),coalesce(nullif(r->>'status',''),'published'),auth.uid())
    on conflict (id) do update set key=excluded.key,title=excluded.title,category=excluded.category,
      current_version=excluded.current_version,status=excluded.status where form_templates.company_id=_cid;
  end loop;
  update form_templates set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'form_templates'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_form_templates"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_loops"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'drawing_loops'->'created','[]'::jsonb) || coalesce(changes->'drawing_loops'->'updated','[]'::jsonb)) loop
    insert into drawing_loops (id,company_id,drawing_id,name,number,color,nodes,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'drawing_id')::uuid,coalesce(r->>'name',''),coalesce((r->>'number')::int,1),
      coalesce(nullif(r->>'color',''),'#0A84FF'),r->>'nodes',auth.uid())
    on conflict (id) do update set name=excluded.name,number=excluded.number,color=excluded.color,nodes=excluded.nodes
      where drawing_loops.company_id=_cid;
  end loop;
  update drawing_loops set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'drawing_loops'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_loops"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_markup"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'drawing_markup'->'created','[]'::jsonb) || coalesce(changes->'drawing_markup'->'updated','[]'::jsonb)) loop
    insert into drawing_markup (id,company_id,drawing_id,data,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'drawing_id')::uuid,r->>'data',auth.uid())
    on conflict (id) do update set data=excluded.data where drawing_markup.company_id=_cid;
  end loop;
  update drawing_markup set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'drawing_markup'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_markup"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_members"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'project_members'->'created','[]'::jsonb) || coalesce(changes->'project_members'->'updated','[]'::jsonb)) loop
    insert into project_members (id,company_id,project_id,user_id,user_name,role,is_scan_responsible,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'project_id')::uuid,(r->>'user_id')::uuid,coalesce(r->>'user_name',''),
      coalesce(nullif(r->>'role',''),'montor'),coalesce((r->>'is_scan_responsible')::boolean,false),auth.uid())
    on conflict (id) do update set user_name=excluded.user_name,role=excluded.role,
      is_scan_responsible=excluded.is_scan_responsible where project_members.company_id=_cid;
  end loop;
  update project_members set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'project_members'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_members"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_order_scans"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'order_scans'->'created','[]'::jsonb) || coalesce(changes->'order_scans'->'updated','[]'::jsonb)) loop
    insert into order_scans (id,company_id,order_id,kind,title,scan_path,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'order_id')::uuid,coalesce(nullif(r->>'kind',''),'planlegging'),
      coalesce(r->>'title',''),nullif(r->>'scan_path',''),auth.uid())
    on conflict (id) do update set kind=excluded.kind,title=excluded.title,scan_path=excluded.scan_path
      where order_scans.company_id=_cid;
  end loop;
  update order_scans set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'order_scans'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_order_scans"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_rooms"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'rooms'->'created','[]'::jsonb) || coalesce(changes->'rooms'->'updated','[]'::jsonb)) loop
    insert into rooms (id,company_id,project_id,plan,name,progress,scan_path,shape,drawing_id,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'project_id')::uuid,coalesce(r->>'plan',''),coalesce(r->>'name',''),
      r->>'progress',nullif(r->>'scan_path',''),nullif(r->>'shape',''),nullif(r->>'drawing_id','')::uuid,auth.uid())
    on conflict (id) do update set plan=excluded.plan,name=excluded.name,progress=excluded.progress,
      scan_path=excluded.scan_path,shape=excluded.shape,drawing_id=excluded.drawing_id where rooms.company_id=_cid;
  end loop;
  update rooms set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'rooms'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_rooms"("changes" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."watermelon_push_tasks"("changes" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare r jsonb; _cid uuid := public.current_company_id();
begin
  for r in select * from jsonb_array_elements(coalesce(changes->'tasks'->'created','[]'::jsonb) || coalesce(changes->'tasks'->'updated','[]'::jsonb)) loop
    insert into tasks (id,company_id,project_id,room_id,kind,title,status,assigned_to,done_at,created_by)
    values ((r->>'id')::uuid,_cid,(r->>'project_id')::uuid,nullif(r->>'room_id','')::uuid,
      coalesce(nullif(r->>'kind',''),'general'),coalesce(r->>'title',''),coalesce(nullif(r->>'status',''),'open'),
      nullif(r->>'assigned_to','')::uuid,
      case when r->>'done_at' is null then null else to_timestamp((r->>'done_at')::bigint/1000.0) end,
      auth.uid())
    on conflict (id) do update set room_id=excluded.room_id,kind=excluded.kind,title=excluded.title,
      status=excluded.status,assigned_to=excluded.assigned_to,done_at=excluded.done_at
      where tasks.company_id=_cid;
  end loop;
  update tasks set deleted_at=now() where deleted_at is null and company_id=_cid
    and id in (select value::uuid from jsonb_array_elements_text(coalesce(changes->'tasks'->'deleted','[]'::jsonb)));
end $$;


ALTER FUNCTION "public"."watermelon_push_tasks"("changes" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."activities" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "hourly_rate" numeric(12,2),
    "billable" boolean DEFAULT true NOT NULL,
    "vat_type" "text",
    "archived" boolean DEFAULT false NOT NULL,
    "source_system" "text",
    "external_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "org_number" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."companies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customers" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "org_nr" "text",
    "is_company" boolean DEFAULT false NOT NULL,
    "email" "text",
    "phone" "text",
    "address" "text",
    "postal_code" "text",
    "city" "text",
    "note" "text",
    "source_system" "text",
    "external_id" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drawing_loops" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "drawing_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "number" integer DEFAULT 1 NOT NULL,
    "color" "text" DEFAULT '#0A84FF'::"text" NOT NULL,
    "nodes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."drawing_loops" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drawing_markup" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "drawing_id" "uuid" NOT NULL,
    "data" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."drawing_markup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drawings" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT ''::"text" NOT NULL,
    "discipline" "text" DEFAULT 'elkraft'::"text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "file_path" "text",
    "page_count" integer,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."drawings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_comments" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "field_id" "text",
    "version" integer,
    "body" "text" NOT NULL,
    "author_name" "text",
    "resolved" boolean DEFAULT false NOT NULL,
    "resolved_revision" integer,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."form_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_template_revisions" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "version" integer NOT NULL,
    "schema" "text",
    "change_note" "text",
    "changed_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."form_template_revisions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_templates" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "key" "text",
    "title" "text" NOT NULL,
    "category" "text" DEFAULT 'Diverse'::"text" NOT NULL,
    "current_version" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'published'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."form_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'bil'::"text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "reg_nr" "text",
    "tracker_imei" "text",
    CONSTRAINT "locations_type_check" CHECK (("type" = ANY (ARRAY['lager'::"text", 'bil'::"text"])))
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_documents" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "template_id" "text" NOT NULL,
    "template_version" integer DEFAULT 1 NOT NULL,
    "status" "text" DEFAULT 'utkast'::"text" NOT NULL,
    "data" "text",
    "completed_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "ai_field_origin" "text",
    CONSTRAINT "order_documents_status_check" CHECK (("status" = ANY (ARRAY['utkast'::"text", 'fullfort'::"text"])))
);


ALTER TABLE "public"."order_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_materials" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "elnummer" "text",
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "unit" "text" DEFAULT 'stk'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "product_id" "uuid",
    "unit_price" numeric(12,2),
    "cost_price" numeric(12,2),
    "vat_type" "text",
    "billable" boolean,
    "invoiced_at" timestamp with time zone
);


ALTER TABLE "public"."order_materials" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_members" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."order_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_scans" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "kind" "text" DEFAULT 'planlegging'::"text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "scan_path" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."order_scans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_number" integer,
    "title" "text" NOT NULL,
    "description" "text",
    "customer_name" "text",
    "customer_phone" "text",
    "address" "text",
    "status" "public"."order_status" DEFAULT 'mottatt'::"public"."order_status" NOT NULL,
    "assigned_to" "uuid",
    "scheduled_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "customer_id" "uuid",
    "source_system" "text",
    "external_id" "text",
    "invoice_external_id" "text",
    "invoiced_at" timestamp with time zone
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "elnummer" "text",
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "unit" "text" DEFAULT 'stk'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "unit_price" numeric(12,2),
    "cost_price" numeric(12,2),
    "vat_type" "text",
    "income_account" "text",
    "supplier" "text",
    "price_updated_at" timestamp with time zone,
    "source_system" "text",
    "external_id" "text"
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid",
    "role" "public"."app_role" DEFAULT 'montor'::"public"."app_role" NOT NULL,
    "full_name" "text" DEFAULT ''::"text" NOT NULL,
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "role" "text" DEFAULT 'montor'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "is_scan_responsible" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "customer_name" "text",
    "address" "text",
    "status" "text" DEFAULT 'aktiv'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['aktiv'::"text", 'ferdig'::"text", 'arkivert'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rooms" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT ''::"text" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "progress" "text",
    "scan_path" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "shape" "text",
    "drawing_id" "uuid"
);


ALTER TABLE "public"."rooms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scan_workers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "gpu_name" "text" DEFAULT ''::"text" NOT NULL,
    "vram_mb" integer DEFAULT 0 NOT NULL,
    "compute_capability" "text",
    "worker_version" "text" DEFAULT ''::"text" NOT NULL,
    "status" "public"."scan_worker_status" DEFAULT 'offline'::"public"."scan_worker_status" NOT NULL,
    "only_when_idle" boolean DEFAULT true NOT NULL,
    "max_concurrent" integer DEFAULT 1 NOT NULL,
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."scan_workers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."stock_movements" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "quantity" numeric DEFAULT 0 NOT NULL,
    "kind" "text" DEFAULT 'justering'::"text" NOT NULL,
    "order_id" "uuid",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "stock_movements_kind_check" CHECK (("kind" = ANY (ARRAY['inn'::"text", 'ut'::"text", 'overfor'::"text", 'justering'::"text"])))
);


ALTER TABLE "public"."stock_movements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sync_tables" (
    "table_name" "text" NOT NULL,
    "push_order" integer DEFAULT 100 NOT NULL,
    "no_update" "text"[] DEFAULT '{}'::"text"[] NOT NULL
);


ALTER TABLE "public"."sync_tables" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tasks" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "room_id" "uuid",
    "kind" "text" DEFAULT 'general'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assigned_to" "uuid",
    "created_by" "uuid",
    "done_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."time_entries" (
    "id" "uuid" NOT NULL,
    "company_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "date" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hours" numeric(8,2) DEFAULT 0 NOT NULL,
    "note" "text",
    "internal_note" "text",
    "activity_id" "uuid",
    "billable" boolean,
    "invoiced_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."time_entries" OWNER TO "postgres";


ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_org_number_key" UNIQUE ("org_number");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drawing_loops"
    ADD CONSTRAINT "drawing_loops_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drawing_markup"
    ADD CONSTRAINT "drawing_markup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_comments"
    ADD CONSTRAINT "form_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_template_revisions"
    ADD CONSTRAINT "form_template_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_documents"
    ADD CONSTRAINT "order_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_materials"
    ADD CONSTRAINT "order_materials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_members"
    ADD CONSTRAINT "order_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_scans"
    ADD CONSTRAINT "order_scans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_company_id_order_number_key" UNIQUE ("company_id", "order_number");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_jobs"
    ADD CONSTRAINT "scan_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scan_workers"
    ADD CONSTRAINT "scan_workers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sync_tables"
    ADD CONSTRAINT "sync_tables_pkey" PRIMARY KEY ("table_name");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id");



CREATE INDEX "activities_company_updated_idx" ON "public"."activities" USING "btree" ("company_id", "updated_at");



CREATE INDEX "customers_company_name_idx" ON "public"."customers" USING "btree" ("company_id", "name") WHERE ("deleted_at" IS NULL);



CREATE INDEX "customers_company_updated_idx" ON "public"."customers" USING "btree" ("company_id", "updated_at");



CREATE INDEX "drawing_loops_company_idx" ON "public"."drawing_loops" USING "btree" ("company_id");



CREATE INDEX "drawing_loops_drawing_idx" ON "public"."drawing_loops" USING "btree" ("drawing_id");



CREATE INDEX "drawing_loops_updated_idx" ON "public"."drawing_loops" USING "btree" ("updated_at");



CREATE INDEX "drawing_markup_company_idx" ON "public"."drawing_markup" USING "btree" ("company_id");



CREATE INDEX "drawing_markup_drawing_idx" ON "public"."drawing_markup" USING "btree" ("drawing_id");



CREATE INDEX "drawing_markup_updated_idx" ON "public"."drawing_markup" USING "btree" ("updated_at");



CREATE INDEX "drawings_company_idx" ON "public"."drawings" USING "btree" ("company_id");



CREATE INDEX "drawings_project_idx" ON "public"."drawings" USING "btree" ("project_id");



CREATE INDEX "drawings_updated_idx" ON "public"."drawings" USING "btree" ("updated_at");



CREATE INDEX "form_comments_company_idx" ON "public"."form_comments" USING "btree" ("company_id");



CREATE INDEX "form_comments_template_idx" ON "public"."form_comments" USING "btree" ("template_id");



CREATE INDEX "form_comments_updated_idx" ON "public"."form_comments" USING "btree" ("updated_at");



CREATE INDEX "form_revisions_company_idx" ON "public"."form_template_revisions" USING "btree" ("company_id");



CREATE INDEX "form_revisions_template_idx" ON "public"."form_template_revisions" USING "btree" ("template_id");



CREATE INDEX "form_revisions_updated_idx" ON "public"."form_template_revisions" USING "btree" ("updated_at");



CREATE INDEX "form_templates_company_idx" ON "public"."form_templates" USING "btree" ("company_id");



CREATE INDEX "form_templates_updated_idx" ON "public"."form_templates" USING "btree" ("updated_at");



CREATE INDEX "locations_company_idx" ON "public"."locations" USING "btree" ("company_id");



CREATE INDEX "locations_updated_idx" ON "public"."locations" USING "btree" ("updated_at");



CREATE INDEX "order_documents_company_idx" ON "public"."order_documents" USING "btree" ("company_id");



CREATE INDEX "order_documents_order_idx" ON "public"."order_documents" USING "btree" ("order_id");



CREATE INDEX "order_documents_updated_idx" ON "public"."order_documents" USING "btree" ("updated_at");



CREATE INDEX "order_materials_company_idx" ON "public"."order_materials" USING "btree" ("company_id");



CREATE INDEX "order_materials_order_idx" ON "public"."order_materials" USING "btree" ("order_id");



CREATE INDEX "order_materials_updated_idx" ON "public"."order_materials" USING "btree" ("updated_at");



CREATE INDEX "order_members_company_updated_idx" ON "public"."order_members" USING "btree" ("company_id", "updated_at");



CREATE INDEX "order_members_order_idx" ON "public"."order_members" USING "btree" ("order_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "order_scans_company_idx" ON "public"."order_scans" USING "btree" ("company_id");



CREATE INDEX "order_scans_order_idx" ON "public"."order_scans" USING "btree" ("order_id");



CREATE INDEX "order_scans_updated_idx" ON "public"."order_scans" USING "btree" ("updated_at");



CREATE INDEX "orders_company_status_idx" ON "public"."orders" USING "btree" ("company_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "orders_company_updated_idx" ON "public"."orders" USING "btree" ("company_id", "updated_at");



CREATE INDEX "orders_customer_idx" ON "public"."orders" USING "btree" ("customer_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "products_company_elnummer_idx" ON "public"."products" USING "btree" ("company_id", "elnummer") WHERE (("elnummer" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "products_company_idx" ON "public"."products" USING "btree" ("company_id");



CREATE INDEX "products_elnummer_idx" ON "public"."products" USING "btree" ("company_id", "elnummer");



CREATE INDEX "products_updated_idx" ON "public"."products" USING "btree" ("updated_at");



CREATE INDEX "project_members_company_idx" ON "public"."project_members" USING "btree" ("company_id");



CREATE INDEX "project_members_project_idx" ON "public"."project_members" USING "btree" ("project_id");



CREATE INDEX "project_members_updated_idx" ON "public"."project_members" USING "btree" ("updated_at");



CREATE INDEX "projects_company_idx" ON "public"."projects" USING "btree" ("company_id");



CREATE INDEX "projects_updated_idx" ON "public"."projects" USING "btree" ("updated_at");



CREATE INDEX "rooms_company_idx" ON "public"."rooms" USING "btree" ("company_id");



CREATE INDEX "rooms_drawing_idx" ON "public"."rooms" USING "btree" ("drawing_id");



CREATE INDEX "rooms_project_idx" ON "public"."rooms" USING "btree" ("project_id");



CREATE INDEX "rooms_updated_idx" ON "public"."rooms" USING "btree" ("updated_at");



CREATE INDEX "scan_jobs_lease_idx" ON "public"."scan_jobs" USING "btree" ("lease_expires_at") WHERE ("status" = 'running'::"public"."scan_job_status");



CREATE INDEX "scan_jobs_queue_idx" ON "public"."scan_jobs" USING "btree" ("company_id", "status", "priority" DESC, "created_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "scan_workers_company_idx" ON "public"."scan_workers" USING "btree" ("company_id", "status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "stock_movements_company_idx" ON "public"."stock_movements" USING "btree" ("company_id");



CREATE INDEX "stock_movements_loc_idx" ON "public"."stock_movements" USING "btree" ("location_id");



CREATE INDEX "stock_movements_prod_idx" ON "public"."stock_movements" USING "btree" ("product_id");



CREATE INDEX "stock_movements_updated_idx" ON "public"."stock_movements" USING "btree" ("updated_at");



CREATE INDEX "tasks_assigned_idx" ON "public"."tasks" USING "btree" ("assigned_to");



CREATE INDEX "tasks_company_idx" ON "public"."tasks" USING "btree" ("company_id");



CREATE INDEX "tasks_project_idx" ON "public"."tasks" USING "btree" ("project_id");



CREATE INDEX "tasks_updated_idx" ON "public"."tasks" USING "btree" ("updated_at");



CREATE INDEX "time_entries_company_updated_idx" ON "public"."time_entries" USING "btree" ("company_id", "updated_at");



CREATE INDEX "time_entries_order_idx" ON "public"."time_entries" USING "btree" ("order_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "time_entries_user_date_idx" ON "public"."time_entries" USING "btree" ("user_id", "date") WHERE ("deleted_at" IS NULL);



CREATE OR REPLACE TRIGGER "activities_touch" BEFORE UPDATE ON "public"."activities" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "companies_touch" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "customers_touch" BEFORE UPDATE ON "public"."customers" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "drawing_loops_touch" BEFORE UPDATE ON "public"."drawing_loops" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "drawing_markup_touch" BEFORE UPDATE ON "public"."drawing_markup" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "drawings_touch" BEFORE UPDATE ON "public"."drawings" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "form_comments_touch" BEFORE UPDATE ON "public"."form_comments" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "form_revisions_touch" BEFORE UPDATE ON "public"."form_template_revisions" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "form_templates_touch" BEFORE UPDATE ON "public"."form_templates" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "locations_touch" BEFORE UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "order_documents_touch" BEFORE UPDATE ON "public"."order_documents" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "order_materials_touch" BEFORE UPDATE ON "public"."order_materials" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "order_members_touch" BEFORE UPDATE ON "public"."order_members" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "order_scans_touch" BEFORE UPDATE ON "public"."order_scans" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "orders_assign_number" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."assign_order_number"();



CREATE OR REPLACE TRIGGER "orders_touch" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "products_touch" BEFORE UPDATE ON "public"."products" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_touch" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "project_members_touch" BEFORE UPDATE ON "public"."project_members" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "projects_touch" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "rooms_touch" BEFORE UPDATE ON "public"."rooms" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "scan_jobs_touch" BEFORE UPDATE ON "public"."scan_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "scan_workers_touch" BEFORE UPDATE ON "public"."scan_workers" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "stock_movements_touch" BEFORE UPDATE ON "public"."stock_movements" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "tasks_touch" BEFORE UPDATE ON "public"."tasks" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



CREATE OR REPLACE TRIGGER "time_entries_touch" BEFORE UPDATE ON "public"."time_entries" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."activities"
    ADD CONSTRAINT "activities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."customers"
    ADD CONSTRAINT "customers_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."drawing_loops"
    ADD CONSTRAINT "drawing_loops_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."drawing_loops"
    ADD CONSTRAINT "drawing_loops_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id");



ALTER TABLE ONLY "public"."drawing_markup"
    ADD CONSTRAINT "drawing_markup_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."drawing_markup"
    ADD CONSTRAINT "drawing_markup_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id");



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."drawings"
    ADD CONSTRAINT "drawings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."form_comments"
    ADD CONSTRAINT "form_comments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."form_comments"
    ADD CONSTRAINT "form_comments_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id");



ALTER TABLE ONLY "public"."form_template_revisions"
    ADD CONSTRAINT "form_template_revisions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."form_template_revisions"
    ADD CONSTRAINT "form_template_revisions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id");



ALTER TABLE ONLY "public"."form_templates"
    ADD CONSTRAINT "form_templates_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."order_documents"
    ADD CONSTRAINT "order_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."order_documents"
    ADD CONSTRAINT "order_documents_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."order_materials"
    ADD CONSTRAINT "order_materials_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."order_materials"
    ADD CONSTRAINT "order_materials_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."order_materials"
    ADD CONSTRAINT "order_materials_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."order_members"
    ADD CONSTRAINT "order_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."order_members"
    ADD CONSTRAINT "order_members_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_members"
    ADD CONSTRAINT "order_members_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."order_members"
    ADD CONSTRAINT "order_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."order_scans"
    ADD CONSTRAINT "order_scans_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."order_scans"
    ADD CONSTRAINT "order_scans_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_drawing_id_fkey" FOREIGN KEY ("drawing_id") REFERENCES "public"."drawings"("id");



ALTER TABLE ONLY "public"."rooms"
    ADD CONSTRAINT "rooms_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."scan_jobs"
    ADD CONSTRAINT "scan_jobs_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "public"."scan_workers"("id");



ALTER TABLE ONLY "public"."scan_jobs"
    ADD CONSTRAINT "scan_jobs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."scan_jobs"
    ADD CONSTRAINT "scan_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."scan_jobs"
    ADD CONSTRAINT "scan_jobs_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."scan_workers"
    ADD CONSTRAINT "scan_workers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."stock_movements"
    ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."tasks"
    ADD CONSTRAINT "tasks_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "public"."activities"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."time_entries"
    ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE "public"."activities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "activities_company_insert" ON "public"."activities" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "activities_company_select" ON "public"."activities" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "activities_company_update" ON "public"."activities" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_member_select" ON "public"."companies" FOR SELECT USING (("id" = "public"."current_company_id"()));



ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "customers_company_insert" ON "public"."customers" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "customers_company_select" ON "public"."customers" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "customers_company_update" ON "public"."customers" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dl_ins" ON "public"."drawing_loops" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dl_sel" ON "public"."drawing_loops" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dl_upd" ON "public"."drawing_loops" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dm_insert" ON "public"."drawing_markup" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dm_select" ON "public"."drawing_markup" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "dm_update" ON "public"."drawing_markup" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."drawing_loops" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drawing_markup" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drawings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "drawings_insert" ON "public"."drawings" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "drawings_select" ON "public"."drawings" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "drawings_update" ON "public"."drawings" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fc_ins" ON "public"."form_comments" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fc_sel" ON "public"."form_comments" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fc_upd" ON "public"."form_comments" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."form_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_template_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."form_templates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fr_ins" ON "public"."form_template_revisions" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fr_sel" ON "public"."form_template_revisions" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "fr_upd" ON "public"."form_template_revisions" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "ft_ins" ON "public"."form_templates" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "ft_sel" ON "public"."form_templates" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "ft_upd" ON "public"."form_templates" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_insert" ON "public"."locations" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "locations_select" ON "public"."locations" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "locations_update" ON "public"."locations" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."order_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_documents_insert" ON "public"."order_documents" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_documents_select" ON "public"."order_documents" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_documents_update" ON "public"."order_documents" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."order_materials" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_materials_insert" ON "public"."order_materials" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_materials_select" ON "public"."order_materials" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_materials_update" ON "public"."order_materials" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."order_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_members_company_insert" ON "public"."order_members" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_members_company_select" ON "public"."order_members" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "order_members_company_update" ON "public"."order_members" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."order_scans" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_company_insert" ON "public"."orders" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "orders_company_select" ON "public"."orders" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "orders_company_update" ON "public"."orders" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "os_ins" ON "public"."order_scans" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "os_sel" ON "public"."order_scans" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "os_upd" ON "public"."order_scans" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_insert" ON "public"."products" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "products_select" ON "public"."products" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "products_update" ON "public"."products" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_company_select" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR ("company_id" = "public"."current_company_id"())));



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "project_members_insert" ON "public"."project_members" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "project_members_select" ON "public"."project_members" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "project_members_update" ON "public"."project_members" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "projects_insert" ON "public"."projects" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "projects_select" ON "public"."projects" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "projects_update" ON "public"."projects" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rooms_insert" ON "public"."rooms" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "rooms_select" ON "public"."rooms" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "rooms_update" ON "public"."rooms" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."scan_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scan_jobs_company_insert" ON "public"."scan_jobs" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "scan_jobs_company_select" ON "public"."scan_jobs" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "scan_jobs_company_update" ON "public"."scan_jobs" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."scan_workers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scan_workers_company_insert" ON "public"."scan_workers" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "scan_workers_company_select" ON "public"."scan_workers" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "scan_workers_company_update" ON "public"."scan_workers" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "stock_movements_insert" ON "public"."stock_movements" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "stock_movements_select" ON "public"."stock_movements" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "stock_movements_update" ON "public"."stock_movements" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."sync_tables" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sync_tables_read" ON "public"."sync_tables" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tasks_insert" ON "public"."tasks" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "tasks_select" ON "public"."tasks" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "tasks_update" ON "public"."tasks" FOR UPDATE USING (("company_id" = "public"."current_company_id"()));



ALTER TABLE "public"."time_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "time_entries_company_insert" ON "public"."time_entries" FOR INSERT WITH CHECK (("company_id" = "public"."current_company_id"()));



CREATE POLICY "time_entries_company_select" ON "public"."time_entries" FOR SELECT USING (("company_id" = "public"."current_company_id"()));



CREATE POLICY "time_entries_company_update" ON "public"."time_entries" FOR UPDATE USING (("company_id" = "public"."current_company_id"())) WITH CHECK (("company_id" = "public"."current_company_id"()));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_watermelon_pull_core"("_cutoff" timestamp with time zone, "_now_ms" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."_watermelon_pull_core"("_cutoff" timestamp with time zone, "_now_ms" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_watermelon_pull_core"("_cutoff" timestamp with time zone, "_now_ms" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."_watermelon_push_core"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."_watermelon_push_core"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_watermelon_push_core"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."assign_order_number"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_order_number"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_order_number"() TO "service_role";



GRANT ALL ON FUNCTION "public"."current_company_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_company_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_company_ai_key"("p_company_id" "uuid", "p_provider" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_company_ai_key"("p_company_id" "uuid", "p_provider" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON TABLE "public"."scan_jobs" TO "anon";
GRANT ALL ON TABLE "public"."scan_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."scan_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_claim_job"("p_worker" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_claim_job"("p_worker" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_claim_job"("p_worker" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_complete"("p_job" "uuid", "p_result_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_complete"("p_job" "uuid", "p_result_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_complete"("p_job" "uuid", "p_result_key" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_fail"("p_job" "uuid", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_fail"("p_job" "uuid", "p_error" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_fail"("p_job" "uuid", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_heartbeat"("p_job" "uuid", "p_progress" integer, "p_stage" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_heartbeat"("p_job" "uuid", "p_progress" integer, "p_stage" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_heartbeat"("p_job" "uuid", "p_progress" integer, "p_stage" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."scan_requeue_expired"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."scan_requeue_expired"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."scan_requeue_expired"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_company_ai_key"("p_company_id" "uuid", "p_key" "text", "p_provider" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_company_ai_key"("p_company_id" "uuid", "p_key" "text", "p_provider" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_hidden_columns"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_hidden_columns"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_hidden_columns"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_payload_in"("_table" "text", "r" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_payload_in"("_table" "text", "r" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_payload_in"("_table" "text", "r" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pull_columns"("_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pull_columns"("_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pull_columns"("_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_pull_expr"("_table" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_pull_expr"("_table" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_pull_expr"("_table" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_pull"("last_pulled_at" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_pull"("last_pulled_at" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push"("changes" "jsonb", "last_pulled_at" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push"("changes" "jsonb", "last_pulled_at" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_form_comments"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_comments"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_comments"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_form_revisions"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_revisions"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_revisions"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_form_templates"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_templates"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_form_templates"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_loops"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_loops"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_loops"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_markup"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_markup"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_markup"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_members"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_members"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_members"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_order_scans"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_order_scans"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_order_scans"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_rooms"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_rooms"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_rooms"("changes" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."watermelon_push_tasks"("changes" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."watermelon_push_tasks"("changes" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."watermelon_push_tasks"("changes" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."activities" TO "anon";
GRANT ALL ON TABLE "public"."activities" TO "authenticated";
GRANT ALL ON TABLE "public"."activities" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON TABLE "public"."customers" TO "anon";
GRANT ALL ON TABLE "public"."customers" TO "authenticated";
GRANT ALL ON TABLE "public"."customers" TO "service_role";



GRANT ALL ON TABLE "public"."drawing_loops" TO "anon";
GRANT ALL ON TABLE "public"."drawing_loops" TO "authenticated";
GRANT ALL ON TABLE "public"."drawing_loops" TO "service_role";



GRANT ALL ON TABLE "public"."drawing_markup" TO "anon";
GRANT ALL ON TABLE "public"."drawing_markup" TO "authenticated";
GRANT ALL ON TABLE "public"."drawing_markup" TO "service_role";



GRANT ALL ON TABLE "public"."drawings" TO "anon";
GRANT ALL ON TABLE "public"."drawings" TO "authenticated";
GRANT ALL ON TABLE "public"."drawings" TO "service_role";



GRANT ALL ON TABLE "public"."form_comments" TO "anon";
GRANT ALL ON TABLE "public"."form_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."form_comments" TO "service_role";



GRANT ALL ON TABLE "public"."form_template_revisions" TO "anon";
GRANT ALL ON TABLE "public"."form_template_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."form_template_revisions" TO "service_role";



GRANT ALL ON TABLE "public"."form_templates" TO "anon";
GRANT ALL ON TABLE "public"."form_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."form_templates" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."order_documents" TO "anon";
GRANT ALL ON TABLE "public"."order_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."order_documents" TO "service_role";



GRANT ALL ON TABLE "public"."order_materials" TO "anon";
GRANT ALL ON TABLE "public"."order_materials" TO "authenticated";
GRANT ALL ON TABLE "public"."order_materials" TO "service_role";



GRANT ALL ON TABLE "public"."order_members" TO "anon";
GRANT ALL ON TABLE "public"."order_members" TO "authenticated";
GRANT ALL ON TABLE "public"."order_members" TO "service_role";



GRANT ALL ON TABLE "public"."order_scans" TO "anon";
GRANT ALL ON TABLE "public"."order_scans" TO "authenticated";
GRANT ALL ON TABLE "public"."order_scans" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."rooms" TO "anon";
GRANT ALL ON TABLE "public"."rooms" TO "authenticated";
GRANT ALL ON TABLE "public"."rooms" TO "service_role";



GRANT ALL ON TABLE "public"."scan_workers" TO "anon";
GRANT ALL ON TABLE "public"."scan_workers" TO "authenticated";
GRANT ALL ON TABLE "public"."scan_workers" TO "service_role";



GRANT ALL ON TABLE "public"."stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."sync_tables" TO "anon";
GRANT ALL ON TABLE "public"."sync_tables" TO "authenticated";
GRANT ALL ON TABLE "public"."sync_tables" TO "service_role";



GRANT ALL ON TABLE "public"."tasks" TO "anon";
GRANT ALL ON TABLE "public"."tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."tasks" TO "service_role";



GRANT ALL ON TABLE "public"."time_entries" TO "anon";
GRANT ALL ON TABLE "public"."time_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."time_entries" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







