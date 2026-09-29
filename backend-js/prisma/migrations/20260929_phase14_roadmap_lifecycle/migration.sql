-- Add lifecycle protection in place. Existing published version IDs and cohort
-- references are neither rewritten nor copied.
ALTER TABLE roadmap_versions
  ADD CONSTRAINT ck_roadmap_versions_lifecycle CHECK (
    version_number > 0 AND status IN ('draft', 'published', 'archived') AND
    ((status = 'draft' AND published_at IS NULL) OR
     (status IN ('published', 'archived') AND published_at IS NOT NULL))
  );

CREATE FUNCTION outpost_guard_roadmap_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Published and archived roadmap versions are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Create a draft before publication' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' THEN
    IF NOT (OLD.status = 'published' AND NEW.status = 'archived' AND
      ROW(NEW.id, NEW.roadmap_id, NEW.version_number, NEW.created_by, NEW.created_at, NEW.published_at)
      IS NOT DISTINCT FROM
      ROW(OLD.id, OLD.roadmap_id, OLD.version_number, OLD.created_by, OLD.created_at, OLD.published_at)) THEN
      RAISE EXCEPTION 'Published and archived roadmap versions are immutable' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.roadmap_id <> OLD.roadmap_id OR
     NEW.version_number <> OLD.version_number OR NEW.created_by <> OLD.created_by OR
     NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Roadmap version identity cannot change' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'Invalid draft transition' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'published' THEN
    IF NEW.published_at IS NULL OR NOT EXISTS (
      SELECT 1 FROM phases WHERE roadmap_version_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM phases p WHERE p.roadmap_version_id = OLD.id AND
        (trim(p.title) = '' OR p.order_index < 1 OR NOT EXISTS
          (SELECT 1 FROM weeks w WHERE w.phase_id = p.id))
    ) OR EXISTS (
      SELECT 1 FROM weeks w JOIN phases p ON p.id = w.phase_id
      WHERE p.roadmap_version_id = OLD.id AND
        (trim(w.title) = '' OR w.order_index < 1 OR NOT EXISTS
          (SELECT 1 FROM topics t WHERE t.week_id = w.id))
    ) OR EXISTS (
      SELECT 1 FROM topics t JOIN weeks w ON w.id = t.week_id
      JOIN phases p ON p.id = w.phase_id
      WHERE p.roadmap_version_id = OLD.id AND
        (trim(t.title) = '' OR t.order_index < 1)
    ) THEN
      RAISE EXCEPTION 'Roadmap draft is incomplete' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_roadmap_version
  BEFORE INSERT OR UPDATE OR DELETE ON roadmap_versions
  FOR EACH ROW EXECUTE FUNCTION outpost_guard_roadmap_version();

CREATE FUNCTION outpost_guard_roadmap_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  content_version uuid;
BEGIN
  IF TG_TABLE_NAME = 'phases' THEN
    content_version := CASE WHEN TG_OP = 'DELETE' THEN OLD.roadmap_version_id ELSE NEW.roadmap_version_id END;
  ELSIF TG_TABLE_NAME = 'weeks' THEN
    SELECT roadmap_version_id INTO content_version FROM phases
      WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.phase_id ELSE NEW.phase_id END;
  ELSE
    SELECT p.roadmap_version_id INTO content_version FROM weeks w
      JOIN phases p ON p.id = w.phase_id
      WHERE w.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.week_id ELSE NEW.week_id END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM roadmap_versions WHERE id = content_version AND status = 'draft' FOR UPDATE) THEN
    RAISE EXCEPTION 'Published and archived roadmap content is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'phases' AND OLD.roadmap_version_id <> NEW.roadmap_version_id THEN
      RAISE EXCEPTION 'Moving curriculum between versions is forbidden' USING ERRCODE = '23514';
    ELSIF TG_TABLE_NAME = 'weeks' AND OLD.phase_id <> NEW.phase_id THEN
      RAISE EXCEPTION 'Moving curriculum between phases is forbidden' USING ERRCODE = '23514';
    ELSIF TG_TABLE_NAME = 'topics' AND OLD.week_id <> NEW.week_id THEN
      RAISE EXCEPTION 'Moving curriculum between weeks is forbidden' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_guard_phases
  BEFORE INSERT OR UPDATE OR DELETE ON phases
  FOR EACH ROW EXECUTE FUNCTION outpost_guard_roadmap_content();
CREATE TRIGGER trg_guard_weeks
  BEFORE INSERT OR UPDATE OR DELETE ON weeks
  FOR EACH ROW EXECUTE FUNCTION outpost_guard_roadmap_content();
CREATE TRIGGER trg_guard_topics
  BEFORE INSERT OR UPDATE OR DELETE ON topics
  FOR EACH ROW EXECUTE FUNCTION outpost_guard_roadmap_content();
