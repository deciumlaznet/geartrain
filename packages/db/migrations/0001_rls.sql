-- Row-level security: each request sets app.client_id, and client-owned tables
-- only show that client's rows. Geartrain staff use a role with BYPASSRLS.
-- Apply after the drizzle-generated table migration.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'legal_entities', 'facts', 'series_points', 'events', 'evaluations', 'rule_states',
    'obligation_tasks', 'approval_policies', 'approvals', 'audit_events',
    'coding_rules', 'tax_category_maps', 'task_evidence'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY client_isolation ON %I USING (client_id = current_setting(''app.client_id'')::uuid) '
      'WITH CHECK (client_id = current_setting(''app.client_id'')::uuid)', t);
  END LOOP;
END $$;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
CREATE POLICY client_isolation ON clients USING (id = current_setting('app.client_id')::uuid);

-- The audit log, evaluation history and task evidence are append-only: grant the application
-- role only SELECT and INSERT on them, never UPDATE or DELETE.
REVOKE UPDATE, DELETE ON audit_events, evaluations, task_evidence FROM PUBLIC;
