-- Sikkerhetshygiene (fra Supabase security advisors etter clean start)

-- Lås search_path i trigger-funksjoner
alter function public.touch_updated_at() set search_path = public;
alter function public.assign_order_number() set search_path = public;

-- handle_new_user skal KUN kjøres av auth-triggeren, aldri via REST-API
revoke execute on function public.handle_new_user() from anon, authenticated;

-- current_company_id: authenticated MÅ beholde execute (RLS-policies kaller den
-- som invoker), men anon har ingenting der å gjøre
revoke execute on function public.current_company_id() from anon;
