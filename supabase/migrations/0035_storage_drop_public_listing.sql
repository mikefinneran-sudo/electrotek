-- Stop anonymous enumeration of public storage buckets.
--
-- Supabase advisor finding: public_bucket_allows_listing (WARN) on the
-- `cms-media` and `product-images` buckets.
--
-- Both buckets are public, so objects are served over
-- /storage/v1/object/public/<bucket>/<path>, which does NOT consult RLS on
-- storage.objects. The broad SELECT policies below therefore contribute
-- nothing to image rendering -- their only effect is to let any anonymous
-- caller hit /storage/v1/object/list/<bucket> and enumerate every file, with
-- names, sizes, timestamps and etags.
--
-- Verified on the freebies-fireworks tenant before rolling out here:
--   before  public object URL -> 200,  anon list -> full metadata
--   after   public object URL -> 200,  anon list -> []
--   catalog page unaffected (HTTP 200)
--
-- Policy names differ across tenants (the platform and the forked tenant
-- repos named them differently), so every known variant is dropped by name.
-- DROP POLICY IF EXISTS is a no-op where the policy is absent.

drop policy if exists "catalog_public_reads_product_images" on storage.objects;
drop policy if exists "cms_public_selects_cms_media_objects" on storage.objects;
drop policy if exists "public read product images" on storage.objects;
