import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { describe, expect, test } from 'vitest';

const migrations = [
  '../../prisma/migrations/0_baseline/migration.sql',
  '../../prisma/migrations/20260928_phase12_organization_invitations/migration.sql',
  '../../prisma/migrations/20260929_phase14_roadmap_lifecycle/migration.sql',
];

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))('Phase 14 migration preservation', () => {
  test('keeps a published version-1 cohort and topic progress unchanged', async () => {
    const connectionString = (process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL)
      .replace(/^postgresql\+psycopg:\/\//, 'postgresql://');
    const client = new pg.Client({ connectionString });
    const schema = `p14_migration_${randomUUID().replaceAll('-', '')}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}", public`);
      for (const relative of migrations.slice(0, 2)) {
        await client.query(await readFile(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
      }
      const user = (await client.query("INSERT INTO users (display_name, account_type) VALUES ('Coordinator', 'coordinator') RETURNING id")).rows[0];
      const student = (await client.query("INSERT INTO users (display_name, account_type) VALUES ('Student', 'student') RETURNING id")).rows[0];
      const org = (await client.query("INSERT INTO organizations (name, slug) VALUES ('Campus', 'phase14-migration') RETURNING id")).rows[0];
      const roadmap = (await client.query('INSERT INTO roadmaps (organization_id, name, created_by) VALUES ($1, $2, $3) RETURNING id',
        [org.id, 'Legacy plan', user.id])).rows[0];
      const version = (await client.query("INSERT INTO roadmap_versions (roadmap_id, version_number, status, created_by, published_at) VALUES ($1, 1, 'published', $2, now()) RETURNING id, published_at",
        [roadmap.id, user.id])).rows[0];
      const phase = (await client.query("INSERT INTO phases (roadmap_version_id, title, order_index) VALUES ($1, 'Phase 1', 1) RETURNING id", [version.id])).rows[0];
      const week = (await client.query("INSERT INTO weeks (phase_id, title, order_index) VALUES ($1, 'Week 1', 1) RETURNING id", [phase.id])).rows[0];
      const topic = (await client.query("INSERT INTO topics (week_id, title, order_index) VALUES ($1, 'Topic 1', 1) RETURNING id", [week.id])).rows[0];
      const cohort = (await client.query("INSERT INTO cohorts (organization_id, roadmap_version_id, name, created_by, invite_code) VALUES ($1, $2, 'Cohort', $3, 'phase14-migration-code') RETURNING id",
        [org.id, version.id, user.id])).rows[0];
      await client.query("INSERT INTO topic_progress (user_id, topic_id, status) VALUES ($1, $2, 'completed')", [student.id, topic.id]);
      await client.query(await readFile(fileURLToPath(new URL(migrations[2], import.meta.url)), 'utf8'));
      const after = (await client.query(`
        SELECT rv.id version_id, rv.version_number, rv.status, rv.published_at,
          c.roadmap_version_id cohort_version_id, tp.topic_id progress_topic_id, tp.status progress_status
        FROM roadmap_versions rv JOIN cohorts c ON c.roadmap_version_id = rv.id
        JOIN phases p ON p.roadmap_version_id = rv.id
        JOIN weeks w ON w.phase_id = p.id JOIN topics t ON t.week_id = w.id
        JOIN topic_progress tp ON tp.topic_id = t.id WHERE rv.id = $1`, [version.id])).rows[0];
      expect(after).toMatchObject({
        version_id: version.id, version_number: 1, status: 'published',
        cohort_version_id: version.id, progress_topic_id: topic.id, progress_status: 'completed',
      });
      expect(after.published_at.getTime()).toBe(version.published_at.getTime());
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  }, 30_000);
});
