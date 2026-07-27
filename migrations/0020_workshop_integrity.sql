-- Integralność operacji warsztatowych przy równoległych zapisach w D1.
-- RAISE(ABORT) przerywa cały DB.batch(), więc przeniesienie uczestnika nie może
-- częściowo zamknąć starego członkostwa, gdy grupa docelowa jest już pełna.

CREATE TRIGGER IF NOT EXISTS workshop_membership_capacity_insert
BEFORE INSERT ON workshop_memberships
WHEN NEW.status IN ('trial', 'active', 'paused')
  AND (SELECT COUNT(*) FROM workshop_memberships
       WHERE group_id = NEW.group_id
         AND status IN ('trial', 'active', 'paused'))
      >= (SELECT capacity FROM workshop_groups WHERE id = NEW.group_id)
BEGIN
  SELECT RAISE(ABORT, 'workshop_group_full');
END;

CREATE TRIGGER IF NOT EXISTS workshop_membership_capacity_update
BEFORE UPDATE OF group_id, status ON workshop_memberships
WHEN NEW.status IN ('trial', 'active', 'paused')
  AND (OLD.status NOT IN ('trial', 'active', 'paused') OR NEW.group_id <> OLD.group_id)
  AND (SELECT COUNT(*) FROM workshop_memberships
       WHERE group_id = NEW.group_id
         AND id <> OLD.id
         AND status IN ('trial', 'active', 'paused'))
      >= (SELECT capacity FROM workshop_groups WHERE id = NEW.group_id)
BEGIN
  SELECT RAISE(ABORT, 'workshop_group_full');
END;

CREATE TRIGGER IF NOT EXISTS workshop_group_capacity_update
BEFORE UPDATE OF capacity ON workshop_groups
WHEN NEW.capacity < (SELECT COUNT(*) FROM workshop_memberships
                     WHERE group_id = OLD.id
                       AND status IN ('trial', 'active', 'paused'))
BEGIN
  SELECT RAISE(ABORT, 'workshop_group_full');
END;

CREATE TRIGGER IF NOT EXISTS workshop_session_overlap_insert
BEFORE INSERT ON workshop_sessions
WHEN NEW.status <> 'cancelled'
  AND EXISTS (
    SELECT 1 FROM workshop_sessions current
    WHERE current.group_id = NEW.group_id
      AND current.status <> 'cancelled'
      AND NEW.starts_at < current.ends_at
      AND NEW.ends_at > current.starts_at
  )
BEGIN
  SELECT RAISE(ABORT, 'workshop_session_overlap');
END;

CREATE TRIGGER IF NOT EXISTS workshop_session_overlap_update
BEFORE UPDATE OF group_id, starts_at, ends_at, status ON workshop_sessions
WHEN NEW.status <> 'cancelled'
  AND EXISTS (
    SELECT 1 FROM workshop_sessions current
    WHERE current.group_id = NEW.group_id
      AND current.id <> OLD.id
      AND current.status <> 'cancelled'
      AND NEW.starts_at < current.ends_at
      AND NEW.ends_at > current.starts_at
  )
BEGIN
  SELECT RAISE(ABORT, 'workshop_session_overlap');
END;
