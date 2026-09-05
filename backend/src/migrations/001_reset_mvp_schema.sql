BEGIN;

DROP TABLE IF EXISTS consumptions;
DROP TABLE IF EXISTS dishes;
DROP TABLE IF EXISTS meal_records;
DROP TABLE IF EXISTS recommended_dishes;
DROP TABLE IF EXISTS ingredients;

\ir ../db/schema.sql

COMMIT;
