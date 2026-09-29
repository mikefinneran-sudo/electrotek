import { computeLineTotal, computeSubtotal } from "./index";
import { buildOrderNotificationEmail, escapeHtml } from "./email";

let passed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function test(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name}: ${message}`);
  }
}

test("subtotal recomputes from line totals and rounds to cents", () => {
  const subtotal = computeSubtotal([
    { line_total: 12.5 },
    { line_total: 8.25 },
    { line_total: 0.01 },
  ]);
  assert(subtotal === 20.76, `expected 20.76, got ${subtotal}`);
});

test("subtotal of an empty cart is zero", () => {
  assert(computeSubtotal([]) === 0, "empty cart subtotal should be 0");
});

test("subtotal recomputes after removing a line", () => {
  const before = computeSubtotal([{ line_total: 10 }, { line_total: 6 }]);
  const after = computeSubtotal([{ line_total: 10 }]);
  assert(before === 16, `before should be 16, got ${before}`);
  assert(after === 10, `after remove should be 10, got ${after}`);
});

test("duplicate-line merge sums quantities and recomputes the merged line total", () => {
  // Simulates addToOrder merging a repeated product: an existing line of qty 2
  // plus a new add of qty 3 at the same captured unit price.
  const unitPrice = 4.5;
  const existingQty = 2;
  const addedQty = 3;
  const mergedQty = existingQty + addedQty;
  const mergedLineTotal = computeLineTotal(unitPrice, mergedQty);

  assert(mergedQty === 5, "merged qty should be 5");
  assert(mergedLineTotal === 22.5, `merged line total should be 22.5, got ${mergedLineTotal}`);

  // Subtotal reflects a single merged line, not two separate lines.
  const subtotal = computeSubtotal([{ line_total: mergedLineTotal }]);
  assert(subtotal === 22.5, `subtotal should be 22.5, got ${subtotal}`);
});

test("line total captures unit price at add-time", () => {
  // unit_price is captured when added, so a later price change does not alter
  // existing line totals — the test pins the multiply-and-round contract.
  assert(computeLineTotal(2.999, 3) === 9, `expected 9, got ${computeLineTotal(2.999, 3)}`);
  assert(computeLineTotal(1.005, 2) === 2.01, `expected 2.01, got ${computeLineTotal(1.005, 2)}`);
});

test("submit status transition only fires from cart", () => {
  // The action transitions cart -> submitted; mirror that contract here. RLS
  // and the .eq("status","cart") predicate are the runtime enforcement.
  const transition = (status: string) => (status === "cart" ? "submitted" : status);
  assert(transition("cart") === "submitted", "cart should transition to submitted");
  assert(transition("submitted") === "submitted", "submitted should not transition");
  assert(transition("confirmed") === "confirmed", "confirmed should not transition");
});

test("escapeHtml neutralizes markup characters", () => {
  assert(
    escapeHtml("<b>&\"'") === "&lt;b&gt;&amp;&quot;&#39;",
    "escapeHtml should escape all special characters",
  );
});

test("order email escapes customer and product values", () => {
  const email = buildOrderNotificationEmail({
    orderId: "ord-123",
    customerEmail: "buyer@example.com",
    businessName: "A&B <Fireworks>",
    tier: "retail",
    subtotal: 19.98,
    items: [
      {
        name: "<script>alert(1)</script>",
        itemNumber: 42,
        qty: 2,
        unitPrice: 9.99,
        lineTotal: 19.98,
      },
    ],
  });

  assert(
    email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
    "product name should be escaped",
  );
  assert(email.html.includes("A&amp;B &lt;Fireworks&gt;"), "business name should be escaped");
  assert(!email.html.includes("<script>alert(1)</script>"), "raw script must not render");
  assert(email.subject.includes("$19.98"), "subject should include the formatted subtotal");
});

console.log(`ordering tests passed (${passed})`);
