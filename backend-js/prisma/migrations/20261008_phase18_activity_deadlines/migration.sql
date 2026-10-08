-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "event_type" VARCHAR(32) NOT NULL,
    "old_status" VARCHAR(16) NOT NULL,
    "new_status" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_week_deadlines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "week_id" UUID NOT NULL,
    "due_at" TIMESTAMPTZ(6) NOT NULL,
    "time_zone" VARCHAR(100) NOT NULL,
    "updated_by" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_week_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deadline_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "week_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "event_type" VARCHAR(16) NOT NULL,
    "old_due_at" TIMESTAMPTZ(6),
    "old_time_zone" VARCHAR(100),
    "due_at" TIMESTAMPTZ(6),
    "time_zone" VARCHAR(100),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deadline_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_activity_org_time" ON "activity_events"("organization_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ix_activity_user_time" ON "activity_events"("user_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ix_activity_topic" ON "activity_events"("topic_id");

-- CreateIndex
CREATE INDEX "ix_deadline_week" ON "cohort_week_deadlines"("week_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_cohort_week_deadline" ON "cohort_week_deadlines"("cohort_id", "week_id");

-- CreateIndex
CREATE INDEX "ix_deadline_change_cohort_time" ON "deadline_changes"("cohort_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ix_deadline_change_week" ON "deadline_changes"("week_id");

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_week_deadlines" ADD CONSTRAINT "cohort_week_deadlines_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_week_deadlines" ADD CONSTRAINT "cohort_week_deadlines_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_week_deadlines" ADD CONSTRAINT "cohort_week_deadlines_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deadline_changes" ADD CONSTRAINT "deadline_changes_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- History is append-only; deletion through foreign-key cascades remains allowed.
CREATE FUNCTION outpost_reject_history_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'History rows cannot be updated' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER activity_events_immutable BEFORE UPDATE ON activity_events
FOR EACH ROW EXECUTE FUNCTION outpost_reject_history_update();
CREATE TRIGGER deadline_changes_immutable BEFORE UPDATE ON deadline_changes
FOR EACH ROW EXECUTE FUNCTION outpost_reject_history_update();

ALTER TABLE activity_events ADD CONSTRAINT ck_activity_transition CHECK (
  (event_type = 'topic_completed' AND old_status = 'not_started' AND new_status = 'completed') OR
  (event_type = 'topic_reopened' AND old_status = 'completed' AND new_status = 'not_started')
);
ALTER TABLE deadline_changes ADD CONSTRAINT ck_deadline_change CHECK (
  (event_type = 'scheduled' AND due_at IS NOT NULL AND time_zone IS NOT NULL) OR
  (event_type = 'removed' AND due_at IS NULL AND time_zone IS NULL AND old_due_at IS NOT NULL)
);
CREATE FUNCTION outpost_check_deadline_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cohorts c JOIN phases p ON p.roadmap_version_id = c.roadmap_version_id
    JOIN weeks w ON w.phase_id = p.id WHERE c.id = NEW.cohort_id AND w.id = NEW.week_id)
  THEN RAISE EXCEPTION 'Deadline week is outside pinned cohort version' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deadline_pinned_version BEFORE INSERT OR UPDATE ON cohort_week_deadlines
FOR EACH ROW EXECUTE FUNCTION outpost_check_deadline_version();
CREATE TRIGGER deadline_change_pinned_version BEFORE INSERT ON deadline_changes
FOR EACH ROW EXECUTE FUNCTION outpost_check_deadline_version();
CREATE FUNCTION outpost_check_activity_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM topics t JOIN weeks w ON w.id = t.week_id
    JOIN phases p ON p.id = w.phase_id JOIN roadmap_versions v ON v.id = p.roadmap_version_id
    JOIN roadmaps r ON r.id = v.roadmap_id WHERE t.id = NEW.topic_id AND r.organization_id = NEW.organization_id)
  THEN RAISE EXCEPTION 'Activity topic is outside organization' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER activity_topic_organization BEFORE INSERT ON activity_events
FOR EACH ROW EXECUTE FUNCTION outpost_check_activity_organization();
