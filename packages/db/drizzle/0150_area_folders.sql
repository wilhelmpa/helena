ALTER TABLE "project_view_folder" ADD COLUMN "folder" text;--> statement-breakpoint
-- Each existing area gets the folder the api derives for a new one (areaFolderSlug and
-- uniqueAreaFolder in apps/api/src/modules/views/area-folder.ts): the name
-- transliterated to lowercase letters, digits and hyphens, at most 48 characters,
-- 'area' when nothing is left, and -2, -3, ... while the project already uses it or
-- the provisioning service manages a folder of that name.
DO $$
DECLARE
  area record;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR area IN
    SELECT "id", "project_id", "name" FROM "project_view_folder" ORDER BY "project_id", "position", "id"
  LOOP
    base := replace(replace(replace(replace(replace(replace(replace(area."name",
      'Ä', 'Ae'), 'Ö', 'Oe'), 'Ü', 'Ue'), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss');
    base := translate(base,
      'ÀÁÂÃÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÙÚÛÝàáâãåçèéêëìíîïñòóôõùúûýÿ',
      'AAAAACEEEEIIIINOOOOUUUYaaaaaceeeeiiiinoooouuuyy');
    base := lower(regexp_replace(base, '[^a-zA-Z0-9]+', '-', 'g'));
    base := rtrim(left(trim(both '-' from base), 48), '-');
    IF base = '' THEN base := 'area'; END IF;
    candidate := base;
    suffix := 2;
    WHILE candidate IN ('assets', 'boards', 'docs', 'files', 'inbox') OR EXISTS (
      SELECT 1 FROM "project_view_folder"
      WHERE "project_id" = area."project_id" AND "folder" = candidate
    ) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;
    UPDATE "project_view_folder" SET "folder" = candidate WHERE "id" = area."id";
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "project_view_folder" ALTER COLUMN "folder" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_view_folder" ADD CONSTRAINT "project_view_folder_project_folder_unique" UNIQUE("project_id","folder");
