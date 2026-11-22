-- Experiment 07: defaults of the freezing-related settings in the lab's PostgreSQL 18.3 (no config changes).
\pset pager off
SELECT name, setting, unit, context FROM pg_settings
WHERE name IN ('vacuum_freeze_min_age','vacuum_freeze_table_age','vacuum_failsafe_age',
  'vacuum_multixact_freeze_min_age','vacuum_multixact_freeze_table_age','vacuum_multixact_failsafe_age',
  'vacuum_max_eager_freeze_failure_rate','autovacuum','autovacuum_freeze_max_age',
  'autovacuum_multixact_freeze_max_age','autovacuum_naptime','autovacuum_max_workers','autovacuum_worker_slots',
  'autovacuum_vacuum_threshold','autovacuum_vacuum_scale_factor','autovacuum_vacuum_max_threshold',
  'autovacuum_vacuum_insert_threshold','autovacuum_vacuum_insert_scale_factor','autovacuum_vacuum_cost_delay',
  'autovacuum_vacuum_cost_limit','vacuum_cost_limit','vacuum_cost_delay','maintenance_work_mem','autovacuum_work_mem',
  'log_autovacuum_min_duration','idle_in_transaction_session_timeout','transaction_timeout','statement_timeout',
  'max_prepared_transactions','hot_standby_feedback','idle_replication_slot_timeout','max_slot_wal_keep_size',
  'autovacuum_freeze_score_weight','track_counts','data_checksums')
ORDER BY name;
