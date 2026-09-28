alter table public.products
  add column if not exists attributes jsonb not null default '{}'::jsonb;

update public.products
set attributes =
  jsonb_strip_nulls(
    jsonb_build_object(
      'effect_type', effect_type,
      'shot_count', shot_count,
      'gram_weight', gram_weight
    )
  ) || coalesce(attributes, '{}'::jsonb);
