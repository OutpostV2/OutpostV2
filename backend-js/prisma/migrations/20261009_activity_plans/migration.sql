CREATE TABLE "activity_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "object_key" VARCHAR(512) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "byte_count" INTEGER NOT NULL,
    "page_count" INTEGER,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "failure" JSONB,
    "pages" JSONB,
    "proposal" JSONB,
    "review_items" JSONB,
    "warnings" JSONB,
    "review_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "roadmap_id" UUID,
    "version_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMPTZ(6),
    CONSTRAINT "activity_plans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "activity_plans_status_check" CHECK ("status" IN ('queued', 'extracting', 'ready', 'failed', 'converted')),
    CONSTRAINT "activity_plans_byte_count_check" CHECK ("byte_count" > 0 AND "byte_count" <= 10485760),
    CONSTRAINT "activity_plans_page_count_check" CHECK ("page_count" IS NULL OR ("page_count" > 0 AND "page_count" <= 50)),
    CONSTRAINT "activity_plans_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "activity_plans_conversion_link_check" CHECK (("roadmap_id" IS NULL) = ("version_id" IS NULL))
);

CREATE UNIQUE INDEX "activity_plans_object_key_key" ON "activity_plans"("object_key");
CREATE UNIQUE INDEX "activity_plans_roadmap_id_key" ON "activity_plans"("roadmap_id");
CREATE UNIQUE INDEX "activity_plans_version_id_key" ON "activity_plans"("version_id");
CREATE INDEX "ix_activity_plans_organization_created" ON "activity_plans"("organization_id", "created_at");
CREATE INDEX "ix_activity_plans_status_created" ON "activity_plans"("status", "created_at");

ALTER TABLE "activity_plans" ADD CONSTRAINT "activity_plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "activity_plans" ADD CONSTRAINT "activity_plans_uploaded_by_fkey"
  FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "activity_plans" ADD CONSTRAINT "activity_plans_roadmap_id_fkey"
  FOREIGN KEY ("roadmap_id") REFERENCES "roadmaps"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "activity_plans" ADD CONSTRAINT "activity_plans_version_id_fkey"
  FOREIGN KEY ("version_id") REFERENCES "roadmap_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
