-- Runs once, only when the Postgres data volume is empty (first `infra:up`).
-- To re-run it, remove the volume: `docker compose down -v` (this deletes all local data).
-- Executed as POSTGRES_USER, which therefore owns the new database.
CREATE DATABASE diffcraft_test;
