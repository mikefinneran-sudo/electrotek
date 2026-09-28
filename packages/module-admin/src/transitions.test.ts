import assert from "node:assert/strict";
import type { OrderStatus } from "./types";
import {
  ADMIN_ORDER_TRANSITIONS,
  ADMIN_TARGET_STATUSES,
  canTransition,
} from "./types";

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  assert(condition, message);
  passed += 1;
}

// --- legal staff transitions --------------------------------------------
check(canTransition("submitted", "confirmed"), "submitted -> confirmed is allowed");
check(canTransition("submitted", "cancelled"), "submitted -> cancelled is allowed");
check(canTransition("confirmed", "fulfilled"), "confirmed -> fulfilled is allowed");
check(canTransition("confirmed", "cancelled"), "confirmed -> cancelled is allowed");
check(canTransition("cart", "cancelled"), "cart -> cancelled (abandon) is allowed");

// --- illegal / skipped transitions --------------------------------------
check(!canTransition("submitted", "fulfilled"), "cannot skip confirmed (submitted -> fulfilled)");
check(!canTransition("cart", "confirmed"), "cannot confirm a cart directly");
check(!canTransition("cart", "submitted"), "staff do not submit carts (customer action)");
check(!canTransition("confirmed", "submitted"), "cannot move backwards confirmed -> submitted");
check(!canTransition("fulfilled", "confirmed"), "fulfilled is terminal (no -> confirmed)");
check(!canTransition("fulfilled", "cancelled"), "fulfilled is terminal (no -> cancelled)");
check(!canTransition("cancelled", "confirmed"), "cancelled is terminal (no -> confirmed)");

// --- no-op self transitions are rejected --------------------------------
check(!canTransition("confirmed", "confirmed"), "self-transition confirmed -> confirmed rejected");
check(!canTransition("fulfilled", "fulfilled"), "self-transition fulfilled -> fulfilled rejected");

// --- terminal states have no outgoing transitions -----------------------
check(ADMIN_ORDER_TRANSITIONS.fulfilled.length === 0, "fulfilled is terminal");
check(ADMIN_ORDER_TRANSITIONS.cancelled.length === 0, "cancelled is terminal");

// --- every reachable target is an allowed staff target (or terminal) ----
// Staff should never be able to drive an order into a status outside the
// advertised target set; cart/submitted are reached via customer actions, not
// admin, so they must never appear as a transition target here.
const reachableTargets = new Set<OrderStatus>();
for (const targets of Object.values(ADMIN_ORDER_TRANSITIONS)) {
  for (const t of targets) reachableTargets.add(t);
}
for (const target of reachableTargets) {
  check(
    ADMIN_TARGET_STATUSES.includes(target),
    `transition target ${target} is within ADMIN_TARGET_STATUSES`,
  );
}
check(!reachableTargets.has("cart"), "cart is never a staff transition target");
check(!reachableTargets.has("submitted"), "submitted is never a staff transition target");

// --- ADMIN_TARGET_STATUSES is exactly the staff-actionable set -----------
check(ADMIN_TARGET_STATUSES.length === 3, "three staff-actionable target statuses");
check(ADMIN_TARGET_STATUSES.includes("confirmed"), "confirmed is a staff target");
check(ADMIN_TARGET_STATUSES.includes("fulfilled"), "fulfilled is a staff target");
check(ADMIN_TARGET_STATUSES.includes("cancelled"), "cancelled is a staff target");

console.log(`admin transition tests passed (${passed})`);
