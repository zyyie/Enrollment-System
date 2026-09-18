-- ONE FILE — paste in Supabase SQL Editor and Run once. Safe dedupe + rename.
-- Do NOT run the old UPDATE block at the bottom of section-names.sql (it causes duplicate key errors).

CREATE OR REPLACE FUNCTION section_slot_name(
  p_strand_code TEXT,
  p_grade_level TEXT,
  p_slot TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(COALESCE(p_strand_code, 'STEM')));
  v_slot TEXT := UPPER(TRIM(COALESCE(p_slot, 'A')));
  v_grade11 BOOLEAN := COALESCE(p_grade_level, '') LIKE '%11%';
BEGIN
  IF v_grade11 THEN
    RETURN CASE v_code
      WHEN 'STEM' THEN CASE WHEN v_slot = 'A' THEN 'Hope' ELSE 'Fortitude' END
      WHEN 'ABM' THEN CASE WHEN v_slot = 'A' THEN 'Faith' ELSE 'Integrity' END
      WHEN 'HUMSS' THEN CASE WHEN v_slot = 'A' THEN 'Perseverance' ELSE 'Courage' END
      WHEN 'ICT' THEN CASE WHEN v_slot = 'A' THEN 'Humility' ELSE 'Kindness' END
      WHEN 'COOKERY' THEN CASE WHEN v_slot = 'A' THEN 'Wisdom' ELSE 'Compassion' END
      WHEN 'EIM' THEN CASE WHEN v_slot = 'A' THEN 'Resilience' ELSE 'Justice' END
      ELSE v_slot
    END;
  END IF;
  RETURN CASE v_code
    WHEN 'STEM' THEN CASE WHEN v_slot = 'A' THEN 'Rizal' ELSE 'Bonifacio' END
    WHEN 'ABM' THEN CASE WHEN v_slot = 'A' THEN 'Aguinaldo' ELSE 'Mabini' END
    WHEN 'HUMSS' THEN CASE WHEN v_slot = 'A' THEN 'Luna' ELSE 'Jacinto' END
    WHEN 'ICT' THEN CASE WHEN v_slot = 'A' THEN 'Zamora' ELSE 'Gomez' END
    WHEN 'COOKERY' THEN CASE WHEN v_slot = 'A' THEN 'Del Pilar' ELSE 'Silang' END
    WHEN 'EIM' THEN CASE WHEN v_slot = 'A' THEN 'Aquino' ELSE 'Malvar' END
    ELSE v_slot
  END;
END;
$$;

CREATE OR REPLACE FUNCTION build_section_name(
  p_strand_code TEXT,
  p_grade_level TEXT,
  p_section_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(COALESCE(p_strand_code, 'STEM')));
  v_grade_num TEXT := CASE WHEN COALESCE(p_grade_level, '') LIKE '%11%' THEN '11' ELSE '12' END;
  v_key TEXT := TRIM(COALESCE(p_section_key, 'A'));
  v_key_upper TEXT := UPPER(v_key);
  v_name TEXT;
BEGIN
  IF v_key ~ '^\s*\w+\s+\d{2}-' THEN
    RETURN v_key;
  END IF;
  IF v_key_upper IN ('A', 'B') THEN
    v_name := section_slot_name(v_code, p_grade_level, v_key_upper);
  ELSE
    v_name := v_key;
  END IF;
  RETURN v_code || ' ' || v_grade_num || '-' || v_name;
END;
$$;

CREATE OR REPLACE FUNCTION infer_section_slot_letter(
  p_strand_code TEXT,
  p_grade_level TEXT,
  p_suffix TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_code TEXT := UPPER(TRIM(COALESCE(p_strand_code, '')));
  v_suffix TEXT := UPPER(TRIM(COALESCE(p_suffix, '')));
  v_g11 BOOLEAN := COALESCE(p_grade_level, '') LIKE '%11%';
BEGIN
  IF v_suffix IN ('A', 'B') THEN RETURN v_suffix; END IF;
  IF v_suffix = UPPER(section_slot_name(v_code, p_grade_level, 'A')) THEN RETURN 'A'; END IF;
  IF v_suffix = UPPER(section_slot_name(v_code, p_grade_level, 'B')) THEN RETURN 'B'; END IF;
  IF v_g11 THEN
    IF v_code = 'ICT' AND v_suffix IN ('WISDOM', 'COMPASSION') THEN
      RETURN CASE WHEN v_suffix = 'WISDOM' THEN 'A' ELSE 'B' END;
    ELSIF v_code = 'COOKERY' AND v_suffix IN ('RESILIENCE', 'JUSTICE') THEN
      RETURN CASE WHEN v_suffix = 'RESILIENCE' THEN 'A' ELSE 'B' END;
    ELSIF v_code = 'EIM' AND v_suffix IN ('HUMILITY', 'KINDNESS') THEN
      RETURN CASE WHEN v_suffix = 'HUMILITY' THEN 'A' ELSE 'B' END;
    END IF;
  ELSE
    IF v_code = 'ICT' AND v_suffix IN ('DEL PILAR', 'SILANG') THEN
      RETURN CASE WHEN v_suffix = 'DEL PILAR' THEN 'A' ELSE 'B' END;
    ELSIF v_code = 'COOKERY' AND v_suffix IN ('AQUINO', 'MALVAR') THEN
      RETURN CASE WHEN v_suffix = 'AQUINO' THEN 'A' ELSE 'B' END;
    ELSIF v_code = 'EIM' AND v_suffix IN ('ZAMORA', 'GOMEZ') THEN
      RETURN CASE WHEN v_suffix = 'ZAMORA' THEN 'A' ELSE 'B' END;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TABLE IF EXISTS _section_rename_backup;
CREATE TEMP TABLE _section_rename_backup AS
SELECT sec.id, sec.name AS old_name, sec.strand_id, sec.grade_level, st.code AS strand_code
FROM sections sec
JOIN strands st ON st.id = sec.strand_id;

UPDATE sections SET name = 'migrate-' || id::text;

DROP TABLE IF EXISTS _section_rename_plan;
CREATE TEMP TABLE _section_rename_plan AS
WITH base AS (
  SELECT
    b.id, b.strand_id, b.grade_level, b.strand_code, b.old_name,
    infer_section_slot_letter(
      b.strand_code, b.grade_level,
      NULLIF(TRIM(SPLIT_PART(b.old_name, '-', 2)), '')
    ) AS inferred_slot,
    ROW_NUMBER() OVER (PARTITION BY b.strand_id, b.grade_level ORDER BY b.id) AS ord_in_strand
  FROM _section_rename_backup b
  WHERE UPPER(b.strand_code) NOT IN ('GAS', 'CSS', 'HE', 'INDARTS', 'OTHER')
),
with_slot AS (
  SELECT id, strand_id, grade_level, strand_code,
    COALESCE(inferred_slot, CASE WHEN ord_in_strand = 1 THEN 'A' WHEN ord_in_strand = 2 THEN 'B' END) AS slot_letter
  FROM base
)
SELECT id, strand_id, grade_level, strand_code, slot_letter,
  build_section_name(strand_code, grade_level, slot_letter) AS target_name,
  ROW_NUMBER() OVER (PARTITION BY strand_id, grade_level, slot_letter ORDER BY id) AS rn
FROM with_slot
WHERE slot_letter IS NOT NULL;

DROP TABLE IF EXISTS _section_dupes;
CREATE TEMP TABLE _section_dupes AS
SELECT id AS dupe_id, strand_id, grade_level, slot_letter FROM _section_rename_plan WHERE rn > 1;

DROP TABLE IF EXISTS _section_keepers;
CREATE TEMP TABLE _section_keepers AS
SELECT id AS keeper_id, strand_id, grade_level, slot_letter, target_name
FROM _section_rename_plan WHERE rn = 1;

UPDATE class_schedules cs SET section_id = k.keeper_id
FROM _section_dupes d
JOIN _section_keepers k ON k.strand_id = d.strand_id AND k.grade_level = d.grade_level AND k.slot_letter = d.slot_letter
WHERE cs.section_id = d.dupe_id
  AND NOT EXISTS (
    SELECT 1 FROM class_schedules x
    WHERE x.subject_id = cs.subject_id AND x.semester_id = cs.semester_id AND x.section_id = k.keeper_id
  );

DELETE FROM class_schedules cs USING _section_dupes d WHERE cs.section_id = d.dupe_id;

UPDATE students s SET section_id = k.keeper_id
FROM _section_dupes d
JOIN _section_keepers k ON k.strand_id = d.strand_id AND k.grade_level = d.grade_level AND k.slot_letter = d.slot_letter
WHERE s.section_id = d.dupe_id;

UPDATE enrollments e SET section_id = k.keeper_id
FROM _section_dupes d
JOIN _section_keepers k ON k.strand_id = d.strand_id AND k.grade_level = d.grade_level AND k.slot_letter = d.slot_letter
WHERE e.section_id = d.dupe_id;

DELETE FROM sections sec USING _section_dupes d WHERE sec.id = d.dupe_id;

UPDATE sections sec SET name = 'fn-' || sec.id::text
FROM _section_keepers k WHERE sec.id = k.keeper_id;

UPDATE sections sec SET name = k.target_name
FROM _section_keepers k WHERE sec.id = k.keeper_id;

UPDATE class_schedules cs SET section_id = k.keeper_id
FROM sections orphan
JOIN _section_keepers k ON k.strand_id = orphan.strand_id AND k.grade_level = orphan.grade_level AND k.slot_letter = 'B'
WHERE cs.section_id = orphan.id AND orphan.name LIKE 'migrate-%'
  AND NOT EXISTS (
    SELECT 1 FROM class_schedules x
    WHERE x.subject_id = cs.subject_id AND x.semester_id = cs.semester_id AND x.section_id = k.keeper_id
  );

DELETE FROM class_schedules cs USING sections orphan
WHERE cs.section_id = orphan.id AND orphan.name LIKE 'migrate-%';

UPDATE students s SET section_id = k.keeper_id
FROM sections orphan
JOIN _section_keepers k ON k.strand_id = orphan.strand_id AND k.grade_level = orphan.grade_level AND k.slot_letter = 'B'
WHERE s.section_id = orphan.id AND orphan.name LIKE 'migrate-%';

UPDATE enrollments e SET section_id = k.keeper_id
FROM sections orphan
JOIN _section_keepers k ON k.strand_id = orphan.strand_id AND k.grade_level = orphan.grade_level AND k.slot_letter = 'B'
WHERE e.section_id = orphan.id AND orphan.name LIKE 'migrate-%';

DELETE FROM sections WHERE name LIKE 'migrate-%';

GRANT EXECUTE ON FUNCTION section_slot_name TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION build_section_name TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION infer_section_slot_letter TO anon, authenticated, service_role;
