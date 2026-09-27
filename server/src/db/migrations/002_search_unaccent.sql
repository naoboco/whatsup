-- Recherche insensible aux accents (« ingenieur » trouve « Ingénieur »). unaccent est une extension « trusted ».
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
