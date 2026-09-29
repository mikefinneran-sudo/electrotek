import "server-only";

import { fetchAllRows } from "@waltersignal/bananaforce-data-supabase/pagination";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { requireStaff } from "./auth";
import {
  MASTER_SHEET_CONTENT_TYPE,
  buildMasterSheetPdf,
  buildMasterSheetWorkbook,
  isMasterSheetFormat,
} from "./master-sheet-formats";
import {
  buildMasterSheetCsv,
  type MasterSheetCategoryRow,
  type MasterSheetProductRow,
} from "./master-sheet";

export interface InventoryExportOptions {
  /** Brand name printed on the PDF header and footer. */
  brandName?: string;
}

/**
 * Factory so a client app can supply its own brand name for the PDF hard copy.
 * The bare `GET` export below keeps the existing brand-less mounts working.
 */
export function createInventoryExportRoute(
  options: InventoryExportOptions = {},
) {
  const brandName = options.brandName?.trim() || "Inventory";

  return async function GET(request: Request): Promise<Response> {
    await requireStaff();

    const url = new URL(request.url);
    const requestedFormat =
      url.searchParams.get("format")?.trim().toLowerCase() ?? "csv";
    if (!isMasterSheetFormat(requestedFormat)) {
      return Response.json(
        { error: "Unsupported format. Use one of: csv, xlsx, pdf." },
        { status: 400 },
      );
    }
    const requestedLocationSlug =
      url.searchParams.get("location")?.trim().toLowerCase() || null;
    const supabase = await getSupabaseServerClient();
    const [
      categoryRes,
      productRes,
      vendorRes,
      inventoryRes,
      locationRes,
      wholesaleRes,
    ] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("categories")
          .select("id, name, sort_order")
          .order("sort_order")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("products")
          .select(
            "id, item_number, name, category_id, pack, sold_as, retail_price, wholesale_excluded, brand_number, upc, vendor_id",
          )
          .order("item_number")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase.from("vendors").select("id, name").range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("inventory")
          .select("product_id, location_id, qty")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("locations")
          .select("id, slug, name")
          .order("sort_order")
          .range(from, to),
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("product_wholesale_prices")
          .select("product_id, wholesale_price")
          .range(from, to),
      ),
    ]);

    if (categoryRes.error)
      return Response.json(
        { error: categoryRes.error.message },
        { status: 500 },
      );
    if (productRes.error)
      return Response.json(
        { error: productRes.error.message },
        { status: 500 },
      );
    if (vendorRes.error)
      return Response.json({ error: vendorRes.error.message }, { status: 500 });
    if (inventoryRes.error)
      return Response.json(
        { error: inventoryRes.error.message },
        { status: 500 },
      );
    if (locationRes.error)
      return Response.json(
        { error: locationRes.error.message },
        { status: 500 },
      );
    if (wholesaleRes.error)
      return Response.json(
        { error: wholesaleRes.error.message },
        { status: 500 },
      );

    const locations = (locationRes.data ?? []) as {
      id: number;
      slug: string;
      name: string;
    }[];
    const stockLocation =
      requestedLocationSlug == null
        ? locations[0]
        : locations.find(
            (location) => location.slug.toLowerCase() === requestedLocationSlug,
          );
    if (!stockLocation) {
      return Response.json({ error: "Unknown location." }, { status: 400 });
    }

    const categories: MasterSheetCategoryRow[] = (
      (categoryRes.data ?? []) as {
        id: number;
        name: string;
        sort_order: number | string;
      }[]
    ).map((category) => ({
      category_id: category.id,
      name: category.name,
      sort_order: Number(category.sort_order),
    }));

    const vendorNameById = new Map(
      ((vendorRes.data ?? []) as { id: number; name: string }[]).map(
        (vendor) => [vendor.id, vendor.name],
      ),
    );
    const wholesaleByProductId = new Map(
      (
        (wholesaleRes.data ?? []) as {
          product_id: number;
          wholesale_price: number | string;
        }[]
      ).map((row) => [row.product_id, Number(row.wholesale_price)]),
    );
    const onHandByProductId = new Map<number, number>();
    for (const row of (inventoryRes.data ?? []) as {
      product_id: number;
      location_id: number;
      qty: number | string;
    }[]) {
      if (row.location_id !== stockLocation.id) continue;
      onHandByProductId.set(
        row.product_id,
        (onHandByProductId.get(row.product_id) ?? 0) + Number(row.qty),
      );
    }

    const products: MasterSheetProductRow[] = (
      (productRes.data ?? []) as {
        id: number;
        item_number: number;
        name: string;
        category_id: number | null;
        pack: string | null;
        sold_as: string | null;
        retail_price: number | string | null;
        wholesale_excluded: boolean;
        brand_number: string | null;
        upc: string | null;
        vendor_id: number | null;
      }[]
    ).map((product) => ({
      id: product.id,
      item_number: product.item_number,
      name: product.name,
      category_id: product.category_id,
      pack: product.pack,
      sold_as: product.sold_as,
      retail_price:
        product.retail_price == null ? null : Number(product.retail_price),
      wholesale_price: wholesaleByProductId.get(product.id) ?? null,
      wholesale_excluded: Boolean(product.wholesale_excluded),
      brand_number: product.brand_number,
      upc: product.upc,
      vendor_name:
        product.vendor_id == null
          ? null
          : (vendorNameById.get(product.vendor_id) ?? null),
      // null (no inventory row at this location) exports as an empty cell so a
      // round-trip re-import does not synthesize a qty-0 record. A real qty-0 row
      // is present in onHandByProductId and still exports as "0".
      on_hand: onHandByProductId.get(product.id) ?? null,
    }));

    const stamp = new Date().toISOString().slice(0, 10);
    const safeSlug = stockLocation.slug.replace(/[^\w-]/g, "_");
    const filename = `bananaforce-master-sheet-${safeSlug}-${stamp}.${requestedFormat}`;
    const sheet = { categories, products };

    const body =
      requestedFormat === "csv"
        ? buildMasterSheetCsv(sheet)
        : requestedFormat === "xlsx"
          ? await buildMasterSheetWorkbook(sheet)
          : await buildMasterSheetPdf(sheet, {
              brandName,
              locationName: stockLocation.name,
              stamp,
            });

    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": MASTER_SHEET_CONTENT_TYPE[requestedFormat],
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  };
}

export const GET = createInventoryExportRoute();
