// Presentation contract derived exclusively from the canonical order summary.
export const salesOverviewFromSummary = ({ totals, products }) => {
  const ranked = products.weightByProduct
    .filter((product) => product.totalQuantity > 0)
    .map(({ productId, productCode, productName, totalQuantity }) => ({ productId, productCode, productName, quantity: totalQuantity }))
    .sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'vi-VN') || String(a.productId).localeCompare(String(b.productId)))
  const leastQuantity = ranked.at(-1)?.quantity
  return {
    orders: totals.orders,
    weight: totals.weight,
    quantity: products.totalQuantity,
    unclassifiedOrders: products.unclassifiedOrders,
    mostSold: ranked[0] || null,
    leastSold: ranked.find((product) => product.quantity === leastQuantity) || null,
    topProducts: ranked.slice(0, 10),
    productTypes: products.productTypes,
  }
}
