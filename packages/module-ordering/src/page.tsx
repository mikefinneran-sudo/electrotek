import { removeItem, submitOrder, addToOrder } from "./actions";
import {
  getCurrentOrder,
  getOrderAccount,
  isOrderingAuthenticated,
  isOrderingConfigured,
} from "./server";
import { isOfflineSalesConfigured } from "./staff-server";
import { AccountView, AddToCartPanel, OfflineSalesView, OrdersView } from "./ui";
import { notFound } from "next/navigation";
import {
  getCurrentCustomer,
  getLocations,
  getProduct,
  getProductAvailability,
  getWholesalePrices,
  isCatalogConfigured,
} from "@waltersignal/bananaforce-module-catalog/server";
import { ProductDetail } from "@waltersignal/bananaforce-module-catalog/ui";

export function createOrdersPage() {
  return async function OrdersPage() {
    const configured = isOrderingConfigured();
    const [authenticated, order] = await Promise.all([
      isOrderingAuthenticated(),
      getCurrentOrder(),
    ]);

    return (
      <OrdersView
        order={order}
        setupRequired={!configured}
        authenticated={authenticated}
        removeItemAction={removeItem}
        submitOrderAction={submitOrder}
      />
    );
  };
}

export function createAccountPage() {
  return async function AccountPage() {
    const account = await getOrderAccount();

    return <AccountView account={account} setupRequired={!isOrderingConfigured()} />;
  };
}

export function createOfflineSalesPage() {
  return function OfflineSalesPage() {
    return (
      <OfflineSalesView
        title="Offline sales queue"
        setupRequired={!isOfflineSalesConfigured()}
      />
    );
  };
}

export function createProductPageWithOrdering() {
  return async function ProductPageWithOrdering({
    params,
  }: {
    params: Promise<{ id: string }>;
  }) {
    const { id } = await params;
    const productId = Number(id);

    if (!Number.isInteger(productId) || productId <= 0) {
      notFound();
    }

    const configured = isCatalogConfigured();
    const [product, customer, locations] = await Promise.all([
      getProduct(productId),
      getCurrentCustomer(),
      getLocations(),
    ]);

    if (!product) {
      if (!configured) {
        return <ProductDetail product={null} setupRequired />;
      }
      notFound();
    }

    const wholesaleEligible =
      !!customer?.approved &&
      (customer.tier === "wholesale_taxed" || customer.tier === "wholesale_exempt");
    const [availability, wholesalePrices] = await Promise.all([
      getProductAvailability([product.id]),
      wholesaleEligible
        ? getWholesalePrices([product.id])
        : Promise.resolve({} as Awaited<ReturnType<typeof getWholesalePrices>>),
    ]);

    const availabilityStatus = availability[product.id];

    return (
      <ProductDetail
        product={product}
        customer={customer}
        wholesalePrice={wholesalePrices[product.id]}
        availability={availabilityStatus}
        locations={locations}
        setupRequired={!configured}
        orderingSlot={
          isOrderingConfigured() ? (
            <AddToCartPanel
              productId={product.id}
              availability={availabilityStatus}
              addToOrderAction={addToOrder}
            />
          ) : null
        }
      />
    );
  };
}
