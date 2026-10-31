-- READ ONLY. Supabase SQL Editor / development. Run BEFORE reviewing the new
-- team migration. No credentials, names, emails or Auth metadata are returned.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
-- Owner cardinality: report conflicts; do not delete/merge or add an index blindly.
SELECT e.id AS enterprise_id,
       count(m.id) FILTER (WHERE m.role='owner') AS owners_total,
       count(m.id) FILTER (WHERE m.role='owner' AND m.status='active') AS owners_active
FROM public.enterprises e LEFT JOIN public.enterprise_members m ON m.enterprise_id=e.id
GROUP BY e.id
HAVING count(m.id) FILTER (WHERE m.role='owner') <> 1
    OR count(m.id) FILTER (WHERE m.role='owner' AND m.status='active') <> 1;
-- Legacy composition and reservations. This does not interpret age as abandonment.
SELECT e.id AS enterprise_id,
       count(m.id) FILTER (WHERE m.role='admin' AND m.status='active') AS active_legacy_admins,
       count(m.id) FILTER (WHERE m.role='admin' AND m.status='inactive') AS inactive_legacy_admins,
       count(m.id) FILTER (WHERE m.role='operator' AND m.status='active') AS active_operators,
       (SELECT count(*) FROM private.employee_provisioning_operations o
        WHERE o.enterprise_id=e.id AND o.status='pending' AND o.requested_role='operator') AS pending_operators,
       (SELECT count(*) FROM private.employee_provisioning_operations o
        WHERE o.enterprise_id=e.id AND o.status='pending' AND o.requested_role='admin') AS pending_admins
FROM public.enterprises e LEFT JOIN public.enterprise_members m ON m.enterprise_id=e.id
GROUP BY e.id
ORDER BY e.id;
ROLLBACK;
