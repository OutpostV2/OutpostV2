CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "role" VARCHAR(16) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "token_hash" VARCHAR(64) NOT NULL,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "accepted_by" UUID,
  "revoked_at" TIMESTAMPTZ(6),
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "organization_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id"),
  CONSTRAINT "organization_invitations_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id"),
  CONSTRAINT "organization_invitations_role_check" CHECK ("role" IN ('coordinator', 'admin', 'mentor')),
  CONSTRAINT "organization_invitations_status_check" CHECK ("status" IN ('pending', 'accepted', 'revoked'))
);

CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE UNIQUE INDEX "uq_organization_invitations_email" ON "organization_invitations"("organization_id", "email");
CREATE INDEX "ix_organization_invitations_organization_id" ON "organization_invitations"("organization_id");
CREATE INDEX "ix_organization_invitations_expires_at" ON "organization_invitations"("expires_at");
