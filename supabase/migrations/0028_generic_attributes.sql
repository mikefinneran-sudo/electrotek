alter table public.products
  add column if not exists attributes jsonb not null default '{}'::jsonb;

alter table public.inspections
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

update public.inspections
set attributes =
  jsonb_strip_nulls(
    jsonb_build_object(
      'cleanable_sqft', cleanable_sqft,
      'visits_per_week', visits_per_week,
      'cleaning_days', cleaning_days,
      'clean_window', clean_window,
      'consumables_provided_by', consumables_provided_by,
      'current_cleaner', current_cleaner,
      'current_cleaner_issues', current_cleaner_issues
    )
  ) || coalesce(attributes, '{}'::jsonb);
