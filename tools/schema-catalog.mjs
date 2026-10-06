export const schemaQueries = {
  columns:
    "select table_schema,table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where (table_schema='public' and table_name in ('practices','practice_memberships','clinicians','credentials','policy_coverage')) or table_schema='private' order by table_schema,table_name,ordinal_position",
  policies:
    "select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname='private' or tablename in ('practices','practice_memberships','clinicians','credentials','policy_coverage') order by schemaname,tablename,policyname",
  functions:
    "select n.nspname,p.proname,pg_get_functiondef(p.oid) definition,p.proacl::text privileges from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.classid='pg_proc'::regclass and d.deptype='e') order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)",
  triggers:
    "select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where (n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage'))) and not t.tgisinternal order by n.nspname,c.relname,t.tgname",
  grants:
    "select grantee,table_schema,table_name,column_name,privilege_type from information_schema.column_privileges where table_name in ('practices','practice_memberships','clinicians','credentials','policy_coverage') or table_schema='private' order by grantee,table_schema,table_name,column_name,privilege_type",
  rls: "select n.nspname,c.relname,c.relrowsecurity from pg_class c join pg_namespace n on c.relnamespace=n.oid where (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage')) or (n.nspname='private' and c.relkind='r') order by n.nspname,c.relname",
  constraints:
    "select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' or (n.nspname='public' and c.relname in ('practices','practice_memberships','clinicians','credentials','policy_coverage')) order by n.nspname,c.relname,k.conname",
  indexes:
    "select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname='private' or (schemaname='public' and tablename in ('practices','practice_memberships','clinicians','credentials','policy_coverage')) order by schemaname,tablename,indexname",
  schemas:
    "select nspname,nspacl::text privileges from pg_namespace where nspname in ('public','private') order by nspname",
};
export async function catalog(db) {
  const result = {};
  for (const [name, sql] of Object.entries(schemaQueries))
    result[name] = (await db.query(sql)).rows;
  return result;
}
