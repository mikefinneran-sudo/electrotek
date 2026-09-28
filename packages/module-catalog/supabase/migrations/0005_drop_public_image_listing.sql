-- Stop anonymous enumeration of the public product-images bucket.
--
-- Catalog's half of the aggregate 0035_storage_drop_public_listing.sql. Split
-- out so a per-module client deploy receives the fix; the aggregate previously
-- carried it for the demo only.
--
-- Supabase advisor finding: public_bucket_allows_listing (WARN).
--
-- The bucket is public, so objects are served over
-- /storage/v1/object/public/<bucket>/<path>, which does NOT consult RLS on
-- storage.objects. The broad SELECT policy below therefore contributes nothing
-- to image rendering -- its only effect is to let any anonymous caller hit
-- /storage/v1/object/list/product-images and enumerate every file, with names,
-- sizes, timestamps and etags.
--
-- Verified on the freebies-fireworks tenant before rolling out:
--   before  public object URL -> 200,  anon list -> full metadata
--   after   public object URL -> 200,  anon list -> []
--   catalog page unaffected (HTTP 200)
--
-- Policy names differ across tenants (the platform and the forked tenant repos
-- named them differently), so every known variant is dropped by name.
-- DROP POLICY IF EXISTS is a no-op where the policy is absent.

drop policy if exists "catalog_public_reads_product_images" on storage.objects;
drop policy if exists "public read product images" on storage.objects;
