import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, test } from 'vitest';

const migrations = [
  '../../prisma/migrations/0_baseline/migration.sql',
  '../../prisma/migrations/20260928_phase12_organization_invitations/migration.sql',
  '../../prisma/migrations/20260929_phase14_roadmap_lifecycle/migration.sql',
  '../../prisma/migrations/20260929_phase15_cohort_governance/migration.sql',
];

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))('Phase 15 migration preservation', () => {
  test('hashes existing cohort codes and preserves enrollment and progress history', async () => {
    const connectionString = (process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL)
      .replace(/^postgresql\+psycopg:\/\//, 'postgresql://');
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 3000 });
    const schema = `p15_migration_${randomUUID().replaceAll('-', '')}`;
    const legacyCode = 'existing-review-code-with-sensitive-entropy';
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const relative of migrations.slice(0, 3)) {
        await client.query(await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
      }
      const coordinator = (await client.query("INSERT INTO users (display_name, account_type) VALUES ('Coordinator', 'coordinator') RETURNING id")).rows[0];
      const student = (await client.query("INSERT INTO users (display_name, account_type) VALUES ('Student', 'student') RETURNING id")).rows[0];
      const legacyStudent = (await client.query("INSERT INTO users (display_name, account_type) VALUES ('Legacy learner', 'student') RETURNING id")).rows[0];
      const org = (await client.query("INSERT INTO organizations (name, slug) VALUES ('Campus', 'phase15-migration') RETURNING id")).rows[0];
      const roadmap = (await client.query('INSERT INTO roadmaps (organization_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        [org.id, 'Legacy plan', coordinator.id])).rows[0];
      const version = (await client.query("INSERT INTO roadmap_versions (roadmap_id, version_number, status, created_by) VALUES ($1, 1, 'draft', $2) RETURNING id",
        [roadmap.id, coordinator.id])).rows[0];
      const phase = (await client.query("INSERT INTO phases (roadmap_version_id, title, order_index) VALUES ($1, 'Phase 1', 1) RETURNING id", [version.id])).rows[0];
      const week = (await client.query("INSERT INTO weeks (phase_id, title, order_index) VALUES ($1, 'Week 1', 1) RETURNING id", [phase.id])).rows[0];
      const topic = (await client.query("INSERT INTO topics (week_id, title, order_index) VALUES ($1, 'Topic 1', 1) RETURNING id", [week.id])).rows[0];
      await client.query("UPDATE roadmap_versions SET status = 'published', published_at = now() WHERE id = $1", [version.id]);
      const cohort = (await client.query("INSERT INTO cohorts (organization_id, roadmap_version_id, name, created_by, invite_code) VALUES ($1, $2, 'Cohort', $3, $4) RETURNING id",
        [org.id, version.id, coordinator.id, legacyCode])).rows[0];
      await client.query("INSERT INTO cohort_enrollments (cohort_id, user_id, status) VALUES ($1, $2, 'active'), ($1, $3, 'inactive')",
        [cohort.id, student.id, legacyStudent.id]);
      await client.query("INSERT INTO topic_progress (user_id, topic_id, status) VALUES ($1, $2, 'completed')", [student.id, topic.id]);

      await client.query(await readFile(fileURLToPath(new URL(migrations[3], import.meta.url)), 'utf8'));

      const after = (await client.query(`
        SELECT c.id, c.roadmap_version_id, c.invite_code_hash, c.invite_code_expires_at,
          e.user_id, e.status enrollment_status, e.ended_at, e.end_reason,
          tp.topic_id, tp.status progress_status
        FROM cohorts c JOIN cohort_enrollments e ON e.cohort_id = c.id
        LEFT JOIN topic_progress tp ON tp.user_id = $2
        WHERE c.id = $1`, [cohort.id, student.id])).rows;
      expect(after).toHaveLength(2);
      expect(after.every((row) => row.roadmap_version_id === version.id)).toBe(true);
      expect(after.every((row) => row.invite_code_hash === createHash('sha256').update(legacyCode).digest('hex'))).toBe(true);
      expect(after.every((row) => row.invite_code_expires_at instanceof Date)).toBe(true);
      expect(after.find((row) => row.user_id === student.id)).toMatchObject({
        enrollment_status: 'active', topic_id: topic.id, progress_status: 'completed',
      });
      expect(after.find((row) => row.user_id === legacyStudent.id)).toMatchObject({
        enrollment_status: 'inactive', end_reason: 'legacy_inactive',
      });
      expect(after.find((row) => row.user_id === legacyStudent.id).ended_at).toBeInstanceOf(Date);
      const oldColumn = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'cohorts' AND column_name = 'invite_code'", [schema]);
      expect(oldColumn.rowCount).toBe(0);
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);
});
