"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { readCsvRows, readXlsxRows } from "@waltersignal/bananaforce-catalog-import/io";
import { recordAudit } from "@waltersignal/bananaforce-data-supabase/audit";
import { getSupabaseServiceClient } from "@waltersignal/bananaforce-data-supabase/service";
import { getSupabaseServerClient } from "@waltersignal/bananaforce-data-supabase/server";
import { requireStaff } from "./auth";
import { parseMasterSheetRows } from "./master-sheet";
import { advanceOrderStatus } from "./server";
import { ADMIN_TARGET_STATUSES, type OrderStatus } from "./types";

const ROLES = ["staff", "admin"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENT_REQUEST_STATUSES = ["new", "contacted", "quoted", "won", "lost"] as const;
const WHOLESALE_INQUIRY_STATUSES = ["new", "contacted", "approved", "declined"] as const;
const LEAD_STATUSES = ["new", "contacted", "qualified", "converted", "lost"] as const;
const ISSUE_REPORT_STATUSES = ["new", "open", "resolved", "closed"] as const;

type ActionResult = { ok?: boolean; error?: string; notice?: string; message?: string; image_url?: string };

function parseMoney(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function publicImageUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/product-images/${path}`;
}

function isOrderTargetStatus(value: string): value is OrderStatus {
  return (ADMIN_TARGET_STATUSES as readonly string[]).includes(value);
}

function isInquiryStatus(table: string, status: string): boolean {
  if (table === "event_requests") {
    return (EVENT_REQUEST_STATUSES as readonly string[]).includes(status);
  }
  if (table === "wholesale_inquiries") {
    return (WHOLESALE_INQUIRY_STATUSES as readonly string[]).includes(status);
  }
  if (table === "leads") {
    return (LEAD_STATUSES as readonly string[]).includes(status);
  }
  if (table === "issue_reports") {
    return (ISSUE_REPORT_STATUSES as readonly string[]).includes(status);
  }
  return false;
}

export async function setInventory(formData: FormData): Promise<void> {
  await requireStaff();
  const productId = Number(formData.get("productId"));
  const locationId = Number(formData.get("locationId"));
  const qty = Number(formData.get("qty"));
  if (!productId || !locationId || !Number.isFinite(qty) || qty < 0) return;

  const supabase = await getSupabaseServerClient();
  await supabase
    .from("inventory")
    .upsert(
      { product_id: productId, location_id: locationId, qty },
      { onConflict: "product_id,location_id" },
    );
  revalidatePath("/admin/inventory");
}

export async function createProduct(formData: FormData): Promise<ActionResult & { productId?: number }> {
  await requireStaff();

  const supabase = getSupabaseServiceClient();
  if (!supabase) return { ok: false, message: "Product creation is not configured." };

  const item_number = Number(formData.get("item_number"));
  if (!Number.isInteger(item_number) || item_number <= 0) {
    return { ok: false, message: "Item # must be a positive whole number." };
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Product name is required." };

  const categoryRaw = formData.get("category_id");
  const category_id =
    categoryRaw == null || categoryRaw === "" ? null : Number(categoryRaw);
  if (category_id != null && (!Number.isInteger(category_id) || category_id <= 0)) {
    return { ok: false, message: "Choose a valid category." };
  }

  const vendorRaw = formData.get("vendor_id");
  const vendor_id = vendorRaw == null || vendorRaw === "" ? null : Number(vendorRaw);
  if (vendor_id != null && (!Number.isInteger(vendor_id) || vendor_id <= 0)) {
    return { ok: false, message: "Choose a valid vendor." };
  }

  const retailRaw = formData.get("retail_price");
  const retail_price = parseMoney(retailRaw);
  if (retailRaw != null && retailRaw !== "" && retail_price == null) {
    return { ok: false, message: "Retail price must be a non-negative number." };
  }

  const wholesaleRaw = formData.get("wholesale_price");
  const wholesale_price = parseMoney(wholesaleRaw);
  if (wholesaleRaw != null && wholesaleRaw !== "" && wholesale_price == null) {
    return { ok: false, message: "Wholesale price must be a non-negative number." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("products")
    .select("id")
    .eq("item_number", item_number)
    .maybeSingle();
  if (existingError) return { ok: false, message: existingError.message };
  if (existing) return { ok: false, message: `Item #${item_number} already exists.` };

  const { data: inserted, error } = await supabase
    .from("products")
    .insert({
      item_number,
      name,
      category_id,
      vendor_id,
      pack: String(formData.get("pack") ?? "").trim() || null,
      sold_as: String(formData.get("sold_as") ?? "").trim() || null,
      retail_price,
      wholesale_excluded: formData.get("wholesale_excluded") === "on",
      brand_number: String(formData.get("brand_number") ?? "").trim() || null,
      upc: String(formData.get("upc") ?? "").trim() || null,
    })
    .select("id")
    .single();

  if (error) {
    const code = "code" in error ? String(error.code) : "";
    return {
      ok: false,
      message:
        code === "23505"
          ? "A product with that item # or UPC already exists."
          : error.message,
    };
  }

  const productId = inserted?.id as number | undefined;
  if (!productId) return { ok: false, message: "Product was not created." };

  if (wholesale_price != null && wholesale_price > 0) {
    const { error: wholesaleError } = await supabase
      .from("product_wholesale_prices")
      .upsert({ product_id: productId, wholesale_price }, { onConflict: "product_id" });
    if (wholesaleError) return { ok: false, message: wholesaleError.message };
  }

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${productId}`);
  revalidatePath("/catalog");
  return { ok: true, message: "Product created.", productId };
}

export async function importMasterSheet(formData: FormData): Promise<{
  ok: boolean;
  message: string;
  productsCreated?: number;
  productsUpdated?: number;
  inventoryUpdated?: number;
  skipped?: number;
  errors?: string[];
}> {
  await requireStaff();

  const supabase = getSupabaseServiceClient();
  if (!supabase) return { ok: false, message: "Master sheet import is not configured." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose a CSV or XLSX file to upload." };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { ok: false, message: "File is too large (max 8 MB)." };
  }

  const filename = file.name.toLowerCase();
  const contentType = file.type.toLowerCase();
  const isCsv = filename.endsWith(".csv") || contentType === "text/csv" || contentType.includes("csv");
  const isXlsx =
    filename.endsWith(".xlsx") ||
    contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    contentType.includes("spreadsheet");

  if (!isCsv && !isXlsx) {
    return { ok: false, message: "Upload a .csv or .xlsx master sheet." };
  }

  let rows: unknown[][];
  try {
    rows = isCsv ? readCsvRows(await file.text()) : await readXlsxRows(await file.arrayBuffer());
  } catch (error) {
    return {
      ok: false,
      message: "Could not read the uploaded file.",
      errors: [error instanceof Error ? error.message : "Unknown file read error."],
    };
  }

  const { catalog, extrasByItemNumber, errors: parseErrors } = parseMasterSheetRows(rows);
  const errors = [...parseErrors];
  if (catalog.products.length === 0) {
    return {
      ok: false,
      message: "No product rows found.",
      skipped: catalog.parseStats.skippedRows + catalog.parseStats.duplicateProducts,
      errors: errors.length ? errors.slice(0, 25) : ["No product rows found."],
    };
  }

  const { data: locations, error: locationsError } = await supabase
    .from("locations")
    .select("id, slug, name")
    .order("sort_order");
  if (locationsError) return { ok: false, message: locationsError.message };
  const locationRows = (locations ?? []) as { id: number; slug: string; name: string }[];
  const requestedLocationRaw = formData.get("stockLocationId");
  const requestedLocationId =
    requestedLocationRaw == null || requestedLocationRaw === ""
      ? null
      : Number(requestedLocationRaw);
  if (
    requestedLocationId != null &&
    (!Number.isInteger(requestedLocationId) || requestedLocationId <= 0)
  ) {
    return { ok: false, message: "Choose a valid stock location." };
  }
  const stockLocation =
    requestedLocationId == null
      ? locationRows[0]
      : locationRows.find((location) => location.id === requestedLocationId);
  if (!stockLocation) return { ok: false, message: "Stock location is not configured." };

  if (catalog.categories.length > 0) {
    const { error } = await supabase
      .from("categories")
      .upsert(
        catalog.categories.map((category) => ({
          id: category.id,
          name: category.name,
          sort_order: category.sort_order,
        })),
        { onConflict: "id" },
      );
    if (error) return { ok: false, message: `Could not save categories: ${error.message}` };
  }

  if (catalog.vendors.length > 0) {
    const { error } = await supabase
      .from("vendors")
      .upsert(
        catalog.vendors.map((vendor) => ({ name: vendor.name })),
        { onConflict: "name" },
      );
    if (error) return { ok: false, message: `Could not save vendors: ${error.message}` };
  }

  // Scope lookups to the imported set. An unfiltered select hits PostgREST's
  // default 1000-row cap and silently truncates on any catalog larger than that.
  const importedItemNumbers = catalog.products.map((product) => product.item_number);
  const importedVendorNames = catalog.vendors.map((vendor) => vendor.name);
  const [{ data: vendorData, error: vendorError }, { data: existingProducts, error: existingError }] =
    await Promise.all([
      importedVendorNames.length > 0
        ? supabase.from("vendors").select("id, name").in("name", importedVendorNames)
        : Promise.resolve({ data: [], error: null }),
      importedItemNumbers.length > 0
        ? supabase.from("products").select("id, item_number").in("item_number", importedItemNumbers)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (vendorError) return { ok: false, message: vendorError.message };
  if (existingError) return { ok: false, message: existingError.message };

  const vendorIdByName = new Map(
    ((vendorData ?? []) as { id: number; name: string }[]).map((vendor) => [
      vendor.name.toLowerCase(),
      vendor.id,
    ]),
  );
  const vendorNameByParsedId = new Map(catalog.vendors.map((vendor) => [vendor.id, vendor.name]));
  const existingItemNumbers = new Set(
    ((existingProducts ?? []) as { item_number: number }[]).map((product) => product.item_number),
  );

  const productRows = catalog.products.map((product) => {
    const vendorName = product.vendor_id == null ? null : vendorNameByParsedId.get(product.vendor_id);
    const extras = extrasByItemNumber.get(product.item_number);

    return {
      item_number: product.item_number,
      name: product.name,
      category_id: product.category_id,
      vendor_id: vendorName ? (vendorIdByName.get(vendorName.toLowerCase()) ?? null) : null,
      brand_number: product.brand_number,
      pack: product.pack,
      sold_as: product.sold_as,
      retail_price: product.retail_price,
      wholesale_excluded: product.wholesale_excluded,
      upc: extras?.upc ?? null,
      // Deliberately omit is_active: the master sheet has no visibility column,
      // so on conflict we must NOT touch it (a round-trip import would otherwise
      // reactivate hidden products). New rows still default to true (schema).
    };
  });

  const { error: productError } = await supabase
    .from("products")
    .upsert(productRows, { onConflict: "item_number" });
  if (productError) {
    const code = "code" in productError ? String(productError.code) : "";
    return {
      ok: false,
      message:
        code === "23505"
          ? "A product with a duplicate item # or UPC could not be imported."
          : `Could not save products: ${productError.message}`,
      errors: errors.length ? errors.slice(0, 25) : undefined,
    };
  }

  const { data: touchedProducts, error: touchedError } =
    importedItemNumbers.length > 0
      ? await supabase.from("products").select("id, item_number").in("item_number", importedItemNumbers)
      : { data: [], error: null };
  if (touchedError) return { ok: false, message: touchedError.message };

  const touchedItemNumbers = new Set(catalog.products.map((product) => product.item_number));
  const productIdByItemNumber = new Map(
    ((touchedProducts ?? []) as { id: number; item_number: number }[])
      .filter((product) => touchedItemNumbers.has(product.item_number))
      .map((product) => [product.item_number, product.id]),
  );

  const wholesaleUpserts: { product_id: number; wholesale_price: number }[] = [];
  const wholesaleDeletes: number[] = [];
  const inventoryUpserts: { product_id: number; location_id: number; qty: number }[] = [];

  for (const product of catalog.products) {
    const productId = productIdByItemNumber.get(product.item_number);
    if (!productId) {
      errors.push(`Item #${product.item_number}: product id was not returned.`);
      continue;
    }

    const extras = extrasByItemNumber.get(product.item_number);
    if (!extras) continue;

    if (extras.wholesale_price != null && extras.wholesale_price > 0) {
      wholesaleUpserts.push({
        product_id: productId,
        wholesale_price: extras.wholesale_price,
      });
    } else if (extras.wholesale_price_clear || extras.wholesale_price === 0) {
      wholesaleDeletes.push(productId);
    }

    if (extras.on_hand != null) {
      inventoryUpserts.push({
        product_id: productId,
        location_id: stockLocation.id,
        qty: extras.on_hand,
      });
    }
  }

  if (wholesaleUpserts.length > 0) {
    const { error } = await supabase
      .from("product_wholesale_prices")
      .upsert(wholesaleUpserts, { onConflict: "product_id" });
    if (error) errors.push(`Wholesale prices: ${error.message}`);
  }

  if (wholesaleDeletes.length > 0) {
    const { error } = await supabase
      .from("product_wholesale_prices")
      .delete()
      .in("product_id", wholesaleDeletes);
    if (error) errors.push(`Wholesale clears: ${error.message}`);
  }

  if (inventoryUpserts.length > 0) {
    const { error } = await supabase
      .from("inventory")
      .upsert(inventoryUpserts, { onConflict: "product_id,location_id" });
    if (error) {
      return {
        ok: false,
        message: `Could not save inventory: ${error.message}`,
        productsCreated: catalog.products.filter((product) => !existingItemNumbers.has(product.item_number)).length,
        productsUpdated: catalog.products.filter((product) => existingItemNumbers.has(product.item_number)).length,
        inventoryUpdated: 0,
        skipped: catalog.parseStats.skippedRows + catalog.parseStats.duplicateProducts,
        errors: errors.length ? errors.slice(0, 25) : undefined,
      };
    }
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/catalog");
  for (const productId of productIdByItemNumber.values()) {
    revalidatePath(`/admin/inventory/${productId}`);
  }

  const productsCreated = catalog.products.filter(
    (product) => !existingItemNumbers.has(product.item_number),
  ).length;
  const productsUpdated = catalog.products.length - productsCreated;
  const skipped = catalog.parseStats.skippedRows + catalog.parseStats.duplicateProducts;

  return {
    ok: true,
    productsCreated,
    productsUpdated,
    inventoryUpdated: inventoryUpserts.length,
    skipped,
    errors: errors.length ? errors.slice(0, 25) : undefined,
    message: `Imported ${productsCreated} new products, updated ${productsUpdated}, and wrote ${inventoryUpserts.length} inventory rows for ${stockLocation.name}.`,
  };
}

export async function updateProductAction(formData: FormData): Promise<ActionResult> {
  await requireStaff();
  const productId = Number(formData.get("productId"));
  if (!productId) return { ok: false, message: "Missing product." };

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, message: "Product name is required." };

  const retail_price = parseMoney(formData.get("retail_price"));
  const unit_price = parseMoney(formData.get("unit_price"));
  const deal_price = parseMoney(formData.get("deal_price"));
  const deal_qtyRaw = formData.get("deal_qty");
  const deal_qty =
    deal_qtyRaw == null || deal_qtyRaw === "" ? null : Number(deal_qtyRaw);
  const promoRaw = String(formData.get("promo_type") ?? "").trim();
  const promo_type =
    promoRaw === "" ? null : promoRaw === "bogo" || promoRaw === "volume" ? promoRaw : null;
  const wholesale_price = parseMoney(formData.get("wholesale_price"));

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("products")
    .update({
      name,
      pack: String(formData.get("pack") ?? "").trim() || null,
      sold_as: String(formData.get("sold_as") ?? "").trim() || null,
      upc: String(formData.get("upc") ?? "").trim() || null,
      retail_price,
      unit_price,
      deal_price,
      deal_qty: deal_qty && deal_qty > 0 ? deal_qty : null,
      promo_type,
      wholesale_excluded: formData.get("wholesale_excluded") === "on",
      is_active: formData.get("is_active") === "on",
      is_featured: formData.get("is_featured") === "on",
      description: String(formData.get("description") ?? "").trim() || null,
      image_url: String(formData.get("image_url") ?? "").trim() || null,
    })
    .eq("id", productId);

  if (error) return { ok: false, message: error.message };

  if (wholesale_price != null && wholesale_price > 0) {
    await supabase
      .from("product_wholesale_prices")
      .upsert({ product_id: productId, wholesale_price });
  } else if (formData.get("clear_wholesale") === "on") {
    await supabase.from("product_wholesale_prices").delete().eq("product_id", productId);
  }

  revalidatePath("/admin/inventory");
  revalidatePath(`/admin/inventory/${productId}`);
  revalidatePath("/catalog");
  return { ok: true, message: "Product saved." };
}

export async function uploadProductImage(formData: FormData): Promise<ActionResult> {
  await requireStaff();
  const productId = Number(formData.get("productId"));
  const file = formData.get("file");
  if (!productId || !(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose an image file." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${productId}/${Date.now()}.${ext}`;
  const supabase = await getSupabaseServerClient();
  const { error: uploadError } = await supabase.storage
    .from("product-images")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) return { ok: false, message: uploadError.message };

  const image_url = publicImageUrl(path);
  await supabase.from("products").update({ image_url }).eq("id", productId);
  revalidatePath(`/admin/inventory/${productId}`);
  return { ok: true, message: "Photo uploaded.", image_url };
}

export async function updateCustomerAction(formData: FormData): Promise<void> {
  await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const tier = String(formData.get("tier") ?? "retail");
  const approved = formData.get("approved") === "on";
  const supabase = await getSupabaseServerClient();
  await supabase.from("customers").update({ tier, approved }).eq("id", id);
  revalidatePath("/admin/customers");
}

export async function updateLocationAction(formData: FormData): Promise<void> {
  await requireStaff();
  const id = Number(formData.get("id"));
  if (!id) return;
  const supabase = await getSupabaseServerClient();
  await supabase
    .from("locations")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      address: String(formData.get("address") ?? "").trim() || null,
      city: String(formData.get("city") ?? "").trim() || null,
      state: String(formData.get("state") ?? "").trim() || null,
      zip: String(formData.get("zip") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      hours: String(formData.get("hours") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidatePath("/admin/locations");
}

export async function updateInquiryStatusAction(formData: FormData): Promise<void> {
  await requireStaff();
  const table = String(formData.get("table") ?? "");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !status || !isInquiryStatus(table, status)) return;
  const supabase = await getSupabaseServerClient();
  await supabase.from(table).update({ status }).eq("id", id);
  const REVALIDATE_PATHS: Record<string, string> = {
    event_requests: "/admin/events",
    leads: "/admin/leads",
    issue_reports: "/admin/clients",
    wholesale_inquiries: "/admin/wholesale",
  };
  revalidatePath(REVALIDATE_PATHS[table] ?? "/admin/wholesale");
}

export async function advanceOrderAction(formData: FormData): Promise<void> {
  const me = await requireStaff();
  const orderId = String(formData.get("orderId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!orderId) return;
  if (!isOrderTargetStatus(status)) {
    console.warn(`Admin order transition rejected: invalid target status ${status}`);
    return;
  }
  const order = await advanceOrderStatus(orderId, status, {
    actor_id: me.id,
    actor_email: me.email,
  });
  if (!order) {
    console.warn("Admin order transition rejected: transition not allowed or order missing");
    return;
  }
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
}

export async function provisionStaff(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const me = await requireStaff();
  if (me.role !== "admin") return { error: "Admins only." };

  const email = String(formData.get("email") || "").trim().toLowerCase();
  const name = String(formData.get("name") || "").trim() || null;
  const roleRaw = String(formData.get("role") || "staff");
  const role = (ROLES as readonly string[]).includes(roleRaw) ? roleRaw : "staff";
  const password = String(formData.get("password") || "");

  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email." };
  if (password.length < 8) return { error: "Temp password must be at least 8 characters." };

  const supabase = getSupabaseServiceClient();
  if (!supabase) return { error: "Staff provisioning is not configured." };

  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) {
    return { error: `Could not create auth user: ${authError.message}` };
  }

  const userId = authData.user?.id;
  if (!userId) {
    return { error: "Could not create auth user." };
  }

  const { error: staffErr } = await supabase
    .from("staff")
    .upsert({ id: userId, email, name, role }, { onConflict: "id" });
  if (staffErr) return { error: `Could not save staff record: ${staffErr.message}` };

  await recordAudit(supabase, {
    actor_id: me.id,
    actor_email: me.email,
    action: "staff.provisioned",
    resource_type: "staff",
    resource_id: userId,
    after: { id: userId, email, name, role },
  });

  revalidatePath("/admin/staff");
  return { ok: true };
}

export async function setStaffRoleAction(formData: FormData): Promise<void> {
  const me = await requireStaff();
  if (me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  const roleRaw = String(formData.get("role") ?? "");
  if (!id || id === me.id || !(ROLES as readonly string[]).includes(roleRaw)) return;
  const supabase = await getSupabaseServerClient();
  const { data: before } = await supabase
    .from("staff")
    .select("id, email, name, role")
    .eq("id", id)
    .maybeSingle();
  const { data: after, error } = await supabase
    .from("staff")
    .update({ role: roleRaw })
    .eq("id", id)
    .select("id, email, name, role")
    .maybeSingle();
  if (!error && after) {
    await recordAudit(getSupabaseServiceClient(), {
      actor_id: me.id,
      actor_email: me.email,
      action: "staff.role_updated",
      resource_type: "staff",
      resource_id: id,
      before,
      after,
    });
  }
  revalidatePath("/admin/staff");
}

export async function removeStaffAction(formData: FormData): Promise<void> {
  const me = await requireStaff();
  if (me.role !== "admin") return;
  const id = String(formData.get("id") ?? "");
  if (!id || id === me.id) return;
  const supabase = await getSupabaseServerClient();
  const { data: before } = await supabase
    .from("staff")
    .select("id, email, name, role")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.from("staff").delete().eq("id", id);
  if (!error) {
    await recordAudit(getSupabaseServiceClient(), {
      actor_id: me.id,
      actor_email: me.email,
      action: "staff.removed",
      resource_type: "staff",
      resource_id: id,
      before,
    });
  }
  revalidatePath("/admin/staff");
}
