-- Replace reversible plaintext cohort join codes with one-way digests.
ALTER TABLE cohorts
  ADD COLUMN invite_code_hash VARCHAR(64),
  ADD COLUMN invite_code_expires_at TIMESTAMPTZ(6),
  ADD COLUMN invite_code_revoked_at TIMESTAMPTZ(6);

UPDATE cohorts
SET invite_code_hash = encode(sha256(convert_to(invite_code, 'UTF8')), 'hex'),
    invite_code_expires_at = CURRENT_TIMESTAMP + INTERVAL '7 days';

ALTER TABLE cohorts
  DROP CONSTRAINT cohorts_invite_code_key,
  DROP COLUMN invite_code;

CREATE UNIQUE INDEX uq_cohorts_invite_code_hash ON cohorts(invite_code_hash);

ALTER TABLE cohort_enrollments
  ADD COLUMN ended_at TIMESTAMPTZ(6),
  ADD COLUMN ended_by UUID,
  ADD COLUMN end_reason VARCHAR(32);

UPDATE cohort_enrollments
SET ended_at = CURRENT_TIMESTAMP,
    end_reason = 'legacy_inactive'
WHERE status = 'inactive';

ALTER TABLE cohort_enrollments
  ADD CONSTRAINT cohort_enrollments_ended_by_fkey
    FOREIGN KEY (ended_by) REFERENCES users(id) ON DELETE SET NULL ON UPDATE NO ACTION,
  ADD CONSTRAINT ck_cohort_enrollments_end_state CHECK (
    (status = 'active' AND ended_at IS NULL AND ended_by IS NULL AND end_reason IS NULL) OR
    (status = 'inactive' AND ended_at IS NOT NULL AND
      end_reason IN ('student_withdrew', 'staff_removed', 'legacy_inactive'))
  );
