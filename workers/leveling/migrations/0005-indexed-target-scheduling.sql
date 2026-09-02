-- Keep numeric scheduling values separate from the original TEXT columns.
-- This lets D1 use ordinary integer range indexes without CAST/COALESCE in the
-- recurring queries while preserving the existing response/storage contract.
ALTER TABLE target_status
ADD COLUMN last_checked_at_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE target_status
ADD COLUMN next_check_at_ms INTEGER NOT NULL DEFAULT 0;

UPDATE target_status
SET
    last_checked_at_ms = CAST(COALESCE(last_checked_at, '0') AS INTEGER),
    next_check_at_ms = CAST(COALESCE(next_check_at, '0') AS INTEGER);

-- Keep every catalog target represented in target_status so scheduling can
-- begin from indexed status rows instead of scanning targets with a LEFT JOIN
-- to discover missing state.
UPDATE target_status
SET
    status = CASE
        WHEN status IS NULL OR TRIM(status) = '' THEN 'Unknown'
        ELSE status
    END,
    status_until = COALESCE(status_until, '0'),
    last_checked_at = COALESCE(last_checked_at, '0'),
    next_check_at = COALESCE(next_check_at, '0'),
    competition_score = COALESCE(competition_score, 0),
    competition_tier = COALESCE(competition_tier, 'Prime'),
    hiding_out = COALESCE(hiding_out, 0),
    permanent_federal = COALESCE(permanent_federal, 0)
WHERE status IS NULL
   OR TRIM(status) = ''
   OR status_until IS NULL
   OR last_checked_at IS NULL
   OR next_check_at IS NULL
   OR competition_score IS NULL
   OR competition_tier IS NULL
   OR hiding_out IS NULL
   OR permanent_federal IS NULL;

INSERT OR IGNORE INTO target_status (
    target_id,
    status,
    status_until,
    last_checked_at,
    next_check_at,
    competition_score,
    competition_tier,
    hiding_out,
    permanent_federal,
    last_checked_at_ms,
    next_check_at_ms,
    updated_at
)
SELECT
    id,
    'Unknown',
    '0',
    '0',
    '0',
    0,
    'Prime',
    0,
    0,
    0,
    0,
    CURRENT_TIMESTAMP
FROM targets;

-- Future targets receive their initial scheduling state in the same write.
CREATE TRIGGER IF NOT EXISTS trg_targets_create_status
AFTER INSERT ON targets
BEGIN
    INSERT OR IGNORE INTO target_status (
        target_id,
        status,
        status_until,
        last_checked_at,
        next_check_at,
        competition_score,
        competition_tier,
        hiding_out,
        permanent_federal,
        last_checked_at_ms,
        next_check_at_ms,
        updated_at
    ) VALUES (
        NEW.id,
        'Unknown',
        '0',
        '0',
        '0',
        0,
        'Prime',
        0,
        0,
        0,
        0,
        CURRENT_TIMESTAMP
    );
END;

-- Scheduling uses 64 stable shards. Each active collector owns only its
-- assigned shards, preventing every collector from reading the whole catalog.
CREATE INDEX IF NOT EXISTS idx_target_status_nonokay_schedule
ON target_status (
    (target_id % 64),
    next_check_at_ms,
    competition_score,
    last_checked_at_ms,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status <> 'Okay';

CREATE INDEX IF NOT EXISTS idx_target_status_prime_schedule
ON target_status (
    (target_id % 64),
    (target_id % 3),
    last_checked_at_ms,
    competition_score,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status = 'Okay'
  AND competition_tier = 'Prime';

CREATE INDEX IF NOT EXISTS idx_target_status_warm_schedule
ON target_status (
    (target_id % 64),
    (target_id % 6),
    last_checked_at_ms,
    competition_score,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status = 'Okay'
  AND competition_tier = 'Warm';

CREATE INDEX IF NOT EXISTS idx_target_status_crowded_schedule
ON target_status (
    (target_id % 64),
    (target_id % 12),
    last_checked_at_ms,
    competition_score,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status = 'Okay'
  AND competition_tier = 'Crowded';

CREATE INDEX IF NOT EXISTS idx_target_status_farmed_schedule
ON target_status (
    (target_id % 64),
    (target_id % 72),
    last_checked_at_ms,
    competition_score,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status = 'Okay'
  AND competition_tier = 'Farmed';

CREATE INDEX IF NOT EXISTS idx_target_status_daily_freshness
ON target_status (
    (target_id % 64),
    (target_id % 3),
    last_checked_at_ms,
    competition_score,
    target_id
)
WHERE hiding_out = 0
  AND permanent_federal = 0
  AND status = 'Okay';
