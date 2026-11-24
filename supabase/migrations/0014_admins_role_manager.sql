-- the Manager role (stored as 'admin') was in the code but not in the database check
alter table admins drop constraint if exists admins_role_check;
alter table admins add constraint admins_role_check check (role = any (array['superadmin','admin','sales','marketing']));
update admins set role = 'admin' where email in ('admin@maxzzdiesel.com','gabriel@maxzzdiesel.com') and role = 'superadmin';
