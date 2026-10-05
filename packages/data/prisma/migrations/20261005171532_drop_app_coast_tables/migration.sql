-- Contract step (track 027): the coastline moved to its own database (packages/data/coastline/
-- schema.sql, COASTLINE_POSTGRES_URL). Safe once no deployed code reads these app-DB tables:
-- test and production both run 904c01c, which never does. The tables are empty.
-- DropTable
DROP TABLE "coast_line";
-- DropTable
DROP TABLE "coast_tile";
-- DropTable
DROP TABLE "coast_water";
