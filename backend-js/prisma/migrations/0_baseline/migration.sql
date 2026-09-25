-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "account_type" AS ENUM ('student', 'coordinator');

-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('login', 'link_phone');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'suspended', 'deleted');

-- CreateTable
CREATE TABLE "alembic_version" (
    "version_num" VARCHAR(32) NOT NULL,

    CONSTRAINT "alembic_version_pkc" PRIMARY KEY ("version_num")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_family_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "user_agent" VARCHAR(512),
    "ip_address" INET,
    "replaced_by_session_id" UUID,

    CONSTRAINT "pk_auth_sessions" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort_enrollments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohort_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohorts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "roadmap_version_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "created_by" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "invite_code" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verification_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "token_hash" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_email_verification_tokens" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "provider_subject" VARCHAR(255) NOT NULL,
    "provider_email" VARCHAR(320),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_oauth_identities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phone_e164" VARCHAR(32) NOT NULL,
    "purpose" "otp_purpose" NOT NULL,
    "otp_digest" VARCHAR(128) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "resend_available_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_otp_challenges" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_credentials" (
    "user_id" UUID NOT NULL,
    "password_hash" VARCHAR(512) NOT NULL,
    "password_changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_password_credentials" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "pk_password_reset_tokens" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roadmap_version_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "phone_e164" VARCHAR(32) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pk_phone_identities" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_topic_progress" (
    "user_id" UUID NOT NULL,
    "topic_key" VARCHAR(64) NOT NULL,
    "completed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_topic_progress_pkey" PRIMARY KEY ("user_id","topic_key")
);

-- CreateTable
CREATE TABLE "roadmap_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "roadmap_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),

    CONSTRAINT "roadmap_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roadmaps" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roadmaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "session_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" INET,
    "user_agent" VARCHAR(512),
    "event_metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "pk_security_events" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topic_progress" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topic_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topics" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "week_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "display_name" VARCHAR(200) NOT NULL,
    "primary_email" VARCHAR(320),
    "email_verified_at" TIMESTAMPTZ(6),
    "username" VARCHAR(64),
    "status" "user_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "account_type" "account_type" NOT NULL DEFAULT 'student',

    CONSTRAINT "pk_users" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "phase_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "order_index" INTEGER NOT NULL,

    CONSTRAINT "weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
ALTER TABLE "auth_sessions" ADD CONSTRAINT "uq_auth_sessions_refresh_token_hash" UNIQUE ("refresh_token_hash");

-- CreateIndex
ALTER TABLE "auth_sessions" ADD CONSTRAINT "uq_auth_sessions_replaced_by_session_id" UNIQUE ("replaced_by_session_id");

-- CreateIndex
CREATE INDEX "ix_auth_sessions_expires_at" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "ix_auth_sessions_token_family_id" ON "auth_sessions"("token_family_id");

-- CreateIndex
CREATE INDEX "ix_auth_sessions_user_id" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "ix_cohort_enrollments_cohort_id" ON "cohort_enrollments"("cohort_id");

-- CreateIndex
CREATE INDEX "ix_cohort_enrollments_user_id" ON "cohort_enrollments"("user_id");

-- CreateIndex
ALTER TABLE "cohort_enrollments" ADD CONSTRAINT "uq_cohort_enrollment" UNIQUE ("cohort_id", "user_id");

-- CreateIndex
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_invite_code_key" UNIQUE ("invite_code");

-- CreateIndex
CREATE INDEX "ix_cohorts_organization_id" ON "cohorts"("organization_id");

-- CreateIndex
CREATE INDEX "ix_cohorts_roadmap_version_id" ON "cohorts"("roadmap_version_id");

-- CreateIndex
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "uq_email_verification_tokens_token_hash" UNIQUE ("token_hash");

-- CreateIndex
CREATE INDEX "ix_email_verification_tokens_expires_at" ON "email_verification_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "ix_email_verification_tokens_user_id" ON "email_verification_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ix_oauth_identities_user_id" ON "oauth_identities"("user_id");

-- CreateIndex
ALTER TABLE "oauth_identities" ADD CONSTRAINT "uq_oauth_identities_provider_subject" UNIQUE ("provider", "provider_subject");

-- CreateIndex
CREATE INDEX "ix_organization_memberships_organization_id" ON "organization_memberships"("organization_id");

-- CreateIndex
CREATE INDEX "ix_organization_memberships_user_id" ON "organization_memberships"("user_id");

-- CreateIndex
ALTER TABLE "organization_memberships" ADD CONSTRAINT "uq_organization_membership" UNIQUE ("organization_id", "user_id");

-- CreateIndex
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");

-- CreateIndex
CREATE INDEX "ix_otp_challenges_expires_at" ON "otp_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "ix_otp_challenges_phone_purpose" ON "otp_challenges"("phone_e164", "purpose");

-- CreateIndex
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "uq_password_reset_tokens_token_hash" UNIQUE ("token_hash");

-- CreateIndex
CREATE INDEX "ix_password_reset_tokens_expires_at" ON "password_reset_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "ix_password_reset_tokens_user_id" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ix_phases_roadmap_version_id" ON "phases"("roadmap_version_id");

-- CreateIndex
ALTER TABLE "phone_identities" ADD CONSTRAINT "uq_phone_identities_phone_e164" UNIQUE ("phone_e164");

-- CreateIndex
CREATE INDEX "ix_phone_identities_user_id" ON "phone_identities"("user_id");

-- CreateIndex
CREATE INDEX "ix_roadmap_versions_roadmap_id" ON "roadmap_versions"("roadmap_id");

-- CreateIndex
ALTER TABLE "roadmap_versions" ADD CONSTRAINT "uq_roadmap_version_number" UNIQUE ("roadmap_id", "version_number");

-- CreateIndex
CREATE INDEX "ix_roadmaps_organization_id" ON "roadmaps"("organization_id");

-- CreateIndex
CREATE INDEX "ix_security_events_session_id" ON "security_events"("session_id");

-- CreateIndex
CREATE INDEX "ix_security_events_type_occurred_at" ON "security_events"("event_type", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_security_events_user_occurred_at" ON "security_events"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "ix_topic_progress_topic_id" ON "topic_progress"("topic_id");

-- CreateIndex
CREATE INDEX "ix_topic_progress_user_id" ON "topic_progress"("user_id");

-- CreateIndex
ALTER TABLE "topic_progress" ADD CONSTRAINT "uq_topic_progress_user_topic" UNIQUE ("user_id", "topic_id");

-- CreateIndex
CREATE INDEX "ix_topics_week_id" ON "topics"("week_id");

-- CreateIndex
ALTER TABLE "users" ADD CONSTRAINT "uq_users_username" UNIQUE ("username");

-- CreateIndex
CREATE INDEX "ix_weeks_phase_id" ON "weeks"("phase_id");

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "fk_auth_sessions_replaced_by_session_id_auth_sessions" FOREIGN KEY ("replaced_by_session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "fk_auth_sessions_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_enrollments" ADD CONSTRAINT "cohort_enrollments_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohorts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohort_enrollments" ADD CONSTRAINT "cohort_enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "cohorts" ADD CONSTRAINT "cohorts_roadmap_version_id_fkey" FOREIGN KEY ("roadmap_version_id") REFERENCES "roadmap_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "fk_email_verification_tokens_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "oauth_identities" ADD CONSTRAINT "fk_oauth_identities_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_credentials" ADD CONSTRAINT "fk_password_credentials_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "fk_password_reset_tokens_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phases" ADD CONSTRAINT "phases_roadmap_version_id_fkey" FOREIGN KEY ("roadmap_version_id") REFERENCES "roadmap_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "phone_identities" ADD CONSTRAINT "fk_phone_identities_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "review_topic_progress" ADD CONSTRAINT "review_topic_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roadmap_versions" ADD CONSTRAINT "roadmap_versions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roadmap_versions" ADD CONSTRAINT "roadmap_versions_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "roadmaps"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roadmaps" ADD CONSTRAINT "roadmaps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_session_id_auth_sessions" FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "fk_security_events_user_id_users" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topic_progress" ADD CONSTRAINT "topic_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "topics" ADD CONSTRAINT "topics_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "phases"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Alembic constraints and expression indexes are not expressible in Prisma Schema.
-- Preserve them verbatim so an isolated database matches the existing schema.
ALTER TABLE "auth_sessions" ADD CONSTRAINT "ck_auth_sessions_expiry_after_creation" CHECK (expires_at > created_at);
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "ck_email_verification_tokens_expiry" CHECK (expires_at > created_at);
ALTER TABLE "otp_challenges" ADD CONSTRAINT "ck_otp_challenges_attempt_count" CHECK (attempt_count >= 0 AND attempt_count <= 5);
ALTER TABLE "otp_challenges" ADD CONSTRAINT "ck_otp_challenges_expiry" CHECK (expires_at > created_at);
ALTER TABLE "otp_challenges" ADD CONSTRAINT "ck_otp_challenges_resend_cooldown" CHECK (resend_available_at >= created_at);
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "ck_password_reset_tokens_expiry" CHECK (expires_at > created_at);

CREATE UNIQUE INDEX "uq_users_primary_email_lower" ON "users" (lower(primary_email));
CREATE UNIQUE INDEX "uq_users_username_lower" ON "users" (lower(username));
