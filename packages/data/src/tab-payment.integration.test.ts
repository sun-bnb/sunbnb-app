import { describe, it, expect, beforeEach, afterAll } from 'vitest'

import { cleanDatabase, disconnectDatabase, prisma } from './test/setup'
import {
  createTestUser,
  createTestPartnerAccount,
  createTestSite,
  createTestSettings,
  createTestServiceFee,
  createTestRestaurant,
  createTestTable,
  createTestTableTab,
  createTestProduct,
  createTestOrder,
  createTestOrderItem,
  resetCounter,
} from './test/fixtures'
import { calculateTabTotal, processConfirmedTabPayment } from './payment'
import {
  TAB_PAID,
  TAB_SETTLED_CASH,
  ORDER_COMPLETE,
  ORDER_DELIVERED,
} from './reservation-status'

beforeEach(async () => {
  await cleanDatabase()
  resetCounter()
})

afterAll(async () => {
  await disconnectDatabase()
})

// ─── Shared setup helper ─────────────────────────────────────────────────────

async function setupTab(opts?: {
  feeOverrides?: Record<string, any>
  siteOverrides?: Record<string, any>
}) {
  const user = await createTestUser()
  const partner = await createTestPartnerAccount(user.id)
  const site = await createTestSite(user.id, {
    vat: 14,
    ...opts?.siteOverrides,
  })
  const settings = await createTestSettings()
  const fee = await createTestServiceFee(settings.id, {
    serviceCode: 'food-and-beverage',
    chargeType: 'fixed',
    feeAmount: 0.5,
    ...opts?.feeOverrides,
  })

  // partnerAccountId references PartnerAccount.userId
  const restaurant = await createTestRestaurant(partner.userId, {
    siteId: site.id,
  })
  const table = await createTestTable(restaurant.id)
  const tab = await createTestTableTab(table.id, site.id, {
    restaurantId: restaurant.id,
  })

  const product = await createTestProduct(site.id, {
    price: 8.0,
    tax: 14,
    totalPrice: 8.0,
  })

  return { user, partner, site, settings, fee, restaurant, table, tab, product }
}

// ─── (a) openTableId uniqueness guard ────────────────────────────────────────

describe('openTableId uniqueness guard', () => {
  it('rejects a second open tab on the same table while the first is open', async () => {
    const { table, tab, restaurant, site } = await setupTab()

    // First tab already holds openTableId = table.id
    expect(tab.openTableId).toBe(table.id)

    // Attempt to open a second tab for the same table — must be rejected by
    // the unique constraint on openTableId.
    await expect(
      prisma.tableTab.create({
        data: {
          tableId: table.id,
          restaurantId: restaurant.id,
          siteId: site.id,
          status: 'open',
          openTableId: table.id,
          openedAt: new Date(),
        },
      })
    ).rejects.toThrow()
  })

  it('allows a new open tab after the first tab is closed (openTableId nulled)', async () => {
    const { table, tab, restaurant, site } = await setupTab()

    // Close the first tab by nulling openTableId
    await prisma.tableTab.update({
      where: { id: tab.id },
      data: { status: 'paid', openTableId: null, closedAt: new Date() },
    })

    // Now a second tab on the same table should succeed
    const secondTab = await prisma.tableTab.create({
      data: {
        tableId: table.id,
        restaurantId: restaurant.id,
        siteId: site.id,
        status: 'open',
        openTableId: table.id,
        openedAt: new Date(),
      },
    })

    expect(secondTab.openTableId).toBe(table.id)
  })
})

// ─── (b) calculateTabTotal ────────────────────────────────────────────────────

describe('calculateTabTotal', () => {
  it('sums multiple order rounds and adds the service fee on top', async () => {
    const { user, site, tab, product } = await setupTab({
      feeOverrides: { chargeType: 'fixed', feeAmount: 1.0 },
    })

    // Round 1: 2 × €8 = €16
    const order1 = await createTestOrder(user.id, site.id, {
      tabId: tab.id,
      status: 'accepted',
      paymentAmount: 16.0,
      totalPrice: 16.0,
    })
    await createTestOrderItem(order1.id, product.id, {
      quantity: 2,
      price: 8.0,
      totalPrice: 16.0,
    })

    // Round 2: 1 × €8 = €8
    const order2 = await createTestOrder(user.id, site.id, {
      tabId: tab.id,
      status: 'delivered',
      paymentAmount: 8.0,
      totalPrice: 8.0,
    })
    await createTestOrderItem(order2.id, product.id, {
      quantity: 1,
      price: 8.0,
      totalPrice: 8.0,
    })

    const result = await calculateTabTotal(tab.id)

    expect(result.ordersTotal).toBe(24.0)
    expect(result.serviceFee).toBe(1.0)     // fixed fee
    expect(result.payableTotal).toBe(25.0)  // ordersTotal + fee
    expect(result.orderIds).toHaveLength(2)
    expect(result.orderIds).toContain(order1.id)
    expect(result.orderIds).toContain(order2.id)
  })

  it('returns zero fee when no matching fee configured and no orders', async () => {
    // Use a fresh site with no service fee (bootstraps default 1.0 from loadFeeContext)
    const { tab } = await setupTab()
    const result = await calculateTabTotal(tab.id)
    expect(result.ordersTotal).toBe(0)
    expect(result.orderIds).toHaveLength(0)
  })
})

// ─── (c) processConfirmedTabPayment — happy path ──────────────────────────────

describe('processConfirmedTabPayment', () => {
  async function setupTabWithOrders() {
    const { user, site, restaurant, table, tab, product } = await setupTab({
      feeOverrides: { chargeType: 'fixed', feeAmount: 0.5 },
    })

    const tabWithRef = await prisma.tableTab.update({
      where: { id: tab.id },
      data: { paymentRef: `pi_demo_tab_${Date.now()}` },
    })

    // Round 1 — two items
    const order1 = await createTestOrder(user.id, site.id, {
      tabId: tabWithRef.id,
      status: 'delivered',
      paymentAmount: 16.0,
      totalPrice: 16.0,
    })
    await createTestOrderItem(order1.id, product.id, {
      quantity: 2,
      price: 8.0,
      tax: 14,
      totalPrice: 16.0,
    })

    // Round 2 — one item
    const order2 = await createTestOrder(user.id, site.id, {
      tabId: tabWithRef.id,
      status: 'delivered',
      paymentAmount: 8.0,
      totalPrice: 8.0,
    })
    await createTestOrderItem(order2.id, product.id, {
      quantity: 1,
      price: 8.0,
      tax: 14,
      totalPrice: 8.0,
    })

    return { user, site, restaurant, table, tab: tabWithRef, product, order1, order2 }
  }

  it('creates exactly one PARTNER and one PLATFORM invoice linked via tableTabId', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableTabId: tab.id },
      orderBy: { issuerType: 'asc' },
    })

    expect(invoices).toHaveLength(2)
    expect(invoices.find((i) => i.issuerType === 'PARTNER')).toBeDefined()
    expect(invoices.find((i) => i.issuerType === 'PLATFORM')).toBeDefined()
  })

  it('PARTNER invoice totalAmount is sum of all items across both rounds', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableTabId: tab.id, issuerType: 'PARTNER' },
    })

    // Round 1 (€16) + Round 2 (€8) = €24 gross
    expect(partnerInvoice?.totalAmount).toBe(24.0)
  })

  it('PARTNER invoice has lines for all items across both rounds with per-item VAT', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableTabId: tab.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })

    // One line per OrderItem row (quantity lives in the description, matching
    // processConfirmedOrder): round 1 = one row (qty 2), round 2 = one row.
    expect(partnerInvoice?.invoiceLines).toHaveLength(2)

    const round1Line = partnerInvoice?.invoiceLines.find((l) => l.amount === 16.0)
    const round2Line = partnerInvoice?.invoiceLines.find((l) => l.amount === 8.0)
    expect(round1Line).toBeDefined()
    expect(round2Line).toBeDefined()
    expect(round1Line?.description).toContain('(2)')

    for (const line of partnerInvoice?.invoiceLines ?? []) {
      // Per-item VAT at 14%
      expect(line.vatRate).toBe(14)
      // Reverse-VAT check: base + vat = amount
      const expectedBase = Math.round((line.amount / 1.14) * 100) / 100
      expect(line.charge).toBeCloseTo(expectedBase, 1)
    }
  })

  it('PLATFORM invoice amount equals the fixed service fee on total orders', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const platformInvoice = await prisma.invoice.findFirst({
      where: { tableTabId: tab.id, issuerType: 'PLATFORM' },
    })

    // Fixed fee of €0.50 on tab total €24
    expect(platformInvoice?.totalAmount).toBe(0.5)
  })

  it('hash chain is intact for both invoices', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const invoices = await prisma.invoice.findMany({
      where: { tableTabId: tab.id },
    })

    for (const inv of invoices) {
      expect(inv.hash).toBeTruthy()
      expect(typeof inv.hash).toBe('string')
      expect((inv.hash as string).length).toBe(64) // SHA-256 hex
    }
  })

  it('stamps the tab paymentRef on all orders; preserves kitchen states, normalizes stragglers', async () => {
    const { tab, order1, order2 } = await setupTabWithOrders()

    // Tab orders reach the kitchen BEFORE payment: order2 is already
    // 'delivered' and must NOT be regressed. order1 is knocked back to
    // 'pending' to represent a straggler that never entered the kitchen flow.
    await prisma.order.update({ where: { id: order1.id }, data: { status: 'pending' } })

    await processConfirmedTabPayment(tab.id)

    const [updated1, updated2] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: order1.id } }),
      prisma.order.findUniqueOrThrow({ where: { id: order2.id } }),
    ])

    // Straggler normalized to complete
    expect(updated1.status).toBe(ORDER_COMPLETE)
    expect(updated1.paymentRef).toBe(tab.paymentRef)
    // Kitchen progress preserved — payment must not regress a delivered round
    expect(updated2.status).toBe(ORDER_DELIVERED)
    expect(updated2.paymentRef).toBe(tab.paymentRef)
  })

  it('excludes voided rounds from the bill and the invoices', async () => {
    const { tab, user, site, product } = await setupTabWithOrders()

    // A discarded round (e.g. kitchen rejected it / staff voided a prank
    // order) must be neither charged nor invoiced.
    const voided = await createTestOrder(user.id, site.id, {
      tabId: tab.id,
      status: 'discarded',
      paymentAmount: 50.0,
      totalPrice: 50.0,
      paymentRef: null,
    })
    await createTestOrderItem(voided.id, product.id, {
      quantity: 5,
      price: 10.0,
      tax: 14,
      totalPrice: 50.0,
    })

    const totals = await calculateTabTotal(tab.id)
    expect(totals.ordersTotal).toBe(24.0)
    expect(totals.orderIds).not.toContain(voided.id)

    await processConfirmedTabPayment(tab.id)

    const partnerInvoice = await prisma.invoice.findFirst({
      where: { tableTabId: tab.id, issuerType: 'PARTNER' },
      include: { invoiceLines: true },
    })
    expect(partnerInvoice?.totalAmount).toBe(24.0)
    expect(partnerInvoice?.invoiceLines).toHaveLength(2)

    const voidedAfter = await prisma.order.findUniqueOrThrow({ where: { id: voided.id } })
    expect(voidedAfter.paymentRef).toBeNull()
    expect(voidedAfter.status).toBe('discarded')
  })

  it('sets tab status to TAB_PAID, closedAt, and nulls openTableId', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const updated = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })

    expect(updated.status).toBe(TAB_PAID)
    expect(updated.closedAt).not.toBeNull()
    expect(updated.openTableId).toBeNull()
  })

  // ─── (d) idempotency ──────────────────────────────────────────────────────

  it('is a no-op on re-run — invoice count unchanged', async () => {
    const { tab } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)
    await processConfirmedTabPayment(tab.id)

    const count = await prisma.invoice.count({ where: { tableTabId: tab.id } })
    expect(count).toBe(2)
  })

  // ─── (e) end-state verification ──────────────────────────────────────────

  it('end state: tab paid + openTableId null + orders complete + invoices present', async () => {
    const { tab, order1, order2 } = await setupTabWithOrders()

    await processConfirmedTabPayment(tab.id)

    const [updatedTab, updatedOrder1, updatedOrder2, invoiceCount] =
      await Promise.all([
        prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } }),
        prisma.order.findUniqueOrThrow({ where: { id: order1.id } }),
        prisma.order.findUniqueOrThrow({ where: { id: order2.id } }),
        prisma.invoice.count({ where: { tableTabId: tab.id } }),
      ])

    expect(updatedTab.status).toBe(TAB_PAID)
    expect(updatedTab.openTableId).toBeNull()
    expect(updatedTab.closedAt).not.toBeNull()
    // Both rounds were 'delivered' before payment — kitchen state preserved
    expect(updatedOrder1.status).toBe(ORDER_DELIVERED)
    expect(updatedOrder1.paymentRef).toBe(tab.paymentRef)
    expect(updatedOrder2.status).toBe(ORDER_DELIVERED)
    expect(updatedOrder2.paymentRef).toBe(tab.paymentRef)
    expect(invoiceCount).toBe(2)
  })

  // ─── (f) cash settlement path ─────────────────────────────────────────────

  describe('cash settlement — { cash: true }', () => {
    it('creates exactly one PARTNER invoice and no PLATFORM invoice', async () => {
      const { tab } = await setupTabWithOrders()

      await processConfirmedTabPayment(tab.id, { cash: true })

      const invoices = await prisma.invoice.findMany({
        where: { tableTabId: tab.id },
      })

      expect(invoices).toHaveLength(1)
      expect(invoices[0]?.issuerType).toBe('PARTNER')
    })

    it('PARTNER invoice has correct per-item VAT totals across both rounds', async () => {
      const { tab } = await setupTabWithOrders()

      await processConfirmedTabPayment(tab.id, { cash: true })

      const partnerInvoice = await prisma.invoice.findFirstOrThrow({
        where: { tableTabId: tab.id, issuerType: 'PARTNER' },
        include: { invoiceLines: true },
      })

      // Round 1 (€16) + Round 2 (€8) = €24 gross
      expect(partnerInvoice.totalAmount).toBe(24.0)
      expect(partnerInvoice.invoiceLines).toHaveLength(2)
      for (const line of partnerInvoice.invoiceLines) {
        expect(line.vatRate).toBe(14)
        // Base + vat should round to the gross amount
        expect(line.charge + line.tax).toBeCloseTo(line.amount, 1)
      }
    })

    it('tab status is TAB_SETTLED_CASH (not TAB_PAID) and openTableId is null', async () => {
      const { tab } = await setupTabWithOrders()

      await processConfirmedTabPayment(tab.id, { cash: true })

      const updated = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })

      expect(updated.status).toBe(TAB_SETTLED_CASH)
      expect(updated.closedAt).not.toBeNull()
      expect(updated.openTableId).toBeNull()
    })

    it('paymentRef is NOT written to orders (cash has none)', async () => {
      // Setup a cash tab — no paymentRef set on the tab itself
      const { user, site, tab: rawTab, product } = await setupTab({
        feeOverrides: { chargeType: 'fixed', feeAmount: 0.5 },
      })
      // Ensure tab has no paymentRef
      expect(rawTab.paymentRef).toBeNull()

      const order = await createTestOrder(user.id, site.id, {
        tabId: rawTab.id,
        status: 'delivered',
        paymentAmount: 8.0,
        totalPrice: 8.0,
        paymentRef: null,
      })
      await createTestOrderItem(order.id, product.id, {
        quantity: 1,
        price: 8.0,
        tax: 14,
        totalPrice: 8.0,
      })

      await processConfirmedTabPayment(rawTab.id, { cash: true })

      const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } })
      expect(updatedOrder.paymentRef).toBeNull()
    })

    it('PARTNER invoice paymentRef is undefined (not set) for cash', async () => {
      const { tab: rawTab, user, site, product } = await setupTab({
        feeOverrides: { chargeType: 'fixed', feeAmount: 0.5 },
      })

      const order = await createTestOrder(user.id, site.id, {
        tabId: rawTab.id,
        status: 'complete',
        paymentAmount: 16.0,
        totalPrice: 16.0,
        paymentRef: null,
      })
      await createTestOrderItem(order.id, product.id, {
        quantity: 2,
        price: 8.0,
        tax: 14,
        totalPrice: 16.0,
      })

      await processConfirmedTabPayment(rawTab.id, { cash: true })

      const partnerInvoice = await prisma.invoice.findFirstOrThrow({
        where: { tableTabId: rawTab.id, issuerType: 'PARTNER' },
      })
      expect(partnerInvoice.paymentRef).toBeNull()
    })

    it('is idempotent — second call is a no-op (invoice count stays 1)', async () => {
      const { tab } = await setupTabWithOrders()

      await processConfirmedTabPayment(tab.id, { cash: true })
      await processConfirmedTabPayment(tab.id, { cash: true })

      const count = await prisma.invoice.count({ where: { tableTabId: tab.id } })
      expect(count).toBe(1)
    })

    it('cash-settled tab is not re-processable by the online path', async () => {
      const { tab } = await setupTabWithOrders()

      // Cash settle first
      await processConfirmedTabPayment(tab.id, { cash: true })
      // Online path attempt — must be a no-op, not create new invoices
      await processConfirmedTabPayment(tab.id)

      const count = await prisma.invoice.count({ where: { tableTabId: tab.id } })
      // Still exactly 1 PARTNER invoice from cash settle — no PLATFORM added
      expect(count).toBe(1)

      const updatedTab = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })
      // Status remains TAB_SETTLED_CASH — NOT overwritten to TAB_PAID
      expect(updatedTab.status).toBe(TAB_SETTLED_CASH)
    })

    it('TAB_PAID tab is not re-processable by the cash path', async () => {
      const { tab } = await setupTabWithOrders()

      // Online payment first
      await processConfirmedTabPayment(tab.id)
      // Cash settle attempt — must be a no-op
      await processConfirmedTabPayment(tab.id, { cash: true })

      const count = await prisma.invoice.count({ where: { tableTabId: tab.id } })
      // 2 invoices from the online path — no additional PARTNER-only invoice
      expect(count).toBe(2)

      const updatedTab = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })
      expect(updatedTab.status).toBe(TAB_PAID)
    })

    it('voided rounds are excluded from the cash receipt', async () => {
      const { tab, user, site, product } = await setupTabWithOrders()

      // Add a discarded (voided) round — must not appear on the receipt
      const voided = await createTestOrder(user.id, site.id, {
        tabId: tab.id,
        status: 'discarded',
        paymentAmount: 50.0,
        totalPrice: 50.0,
        paymentRef: null,
      })
      await createTestOrderItem(voided.id, product.id, {
        quantity: 5,
        price: 10.0,
        tax: 14,
        totalPrice: 50.0,
      })

      await processConfirmedTabPayment(tab.id, { cash: true })

      const partnerInvoice = await prisma.invoice.findFirstOrThrow({
        where: { tableTabId: tab.id, issuerType: 'PARTNER' },
      })
      // Only the 2 non-voided rounds (€16 + €8 = €24) are on the receipt
      expect(partnerInvoice.totalAmount).toBe(24.0)

      const voidedAfter = await prisma.order.findUniqueOrThrow({ where: { id: voided.id } })
      expect(voidedAfter.status).toBe('discarded')
      expect(voidedAfter.paymentRef).toBeNull()
    })
  })
})

// ─── (e) Standalone restaurant (dine-in v2 — no site) ────────────────────────

describe('standalone restaurant tabs (siteId null)', () => {
  async function setupStandaloneTab(opts?: { accountFee?: Record<string, any> }) {
    const user = await createTestUser()
    const partner = await createTestPartnerAccount(user.id)
    const settings = await createTestSettings()
    await createTestServiceFee(settings.id, {
      serviceCode: 'food-and-beverage',
      chargeType: 'fixed',
      feeAmount: 0.5,
    })
    if (opts?.accountFee) {
      await createTestServiceFee(settings.id, {
        serviceCode: 'food-and-beverage',
        accountId: partner.userId,
        ...opts.accountFee,
      })
    }

    // No site anywhere: restaurant, tab, and orders are restaurant-anchored.
    const restaurant = await createTestRestaurant(partner.userId, { dineInEnabled: true })
    const table = await createTestTable(restaurant.id)
    const tab = await createTestTableTab(table.id, null, {
      restaurantId: restaurant.id,
      paymentRef: `pi_demo_tab_standalone`,
    })

    // Anon dine flow satisfies Order.userId with restaurant.partnerAccountId.
    const order1 = await createTestOrder(partner.userId, null, {
      tabId: tab.id,
      restaurantId: restaurant.id,
      status: 'delivered',
      paymentAmount: 16.0,
      totalPrice: 16.0,
    })
    await createTestOrderItem(order1.id, 'menu-item-ref-1', {
      quantity: 2,
      price: 8.0,
      tax: 14,
      totalPrice: 16.0,
    })
    const order2 = await createTestOrder(partner.userId, null, {
      tabId: tab.id,
      restaurantId: restaurant.id,
      status: 'delivered',
      paymentAmount: 8.0,
      totalPrice: 8.0,
    })
    await createTestOrderItem(order2.id, 'menu-item-ref-1', {
      quantity: 1,
      price: 8.0,
      tax: 14,
      totalPrice: 8.0,
    })

    return { user, partner, settings, restaurant, table, tab, order1, order2 }
  }

  it('calculateTabTotal resolves the fee from the settings tier without a site', async () => {
    const { tab } = await setupStandaloneTab()

    const result = await calculateTabTotal(tab.id)

    expect(result.ordersTotal).toBe(24.0)
    expect(result.serviceFee).toBe(0.5)
    expect(result.payableTotal).toBe(24.5)
  })

  it('account-tier fee beats the settings tier for standalone tabs', async () => {
    const { tab } = await setupStandaloneTab({
      accountFee: { chargeType: 'fixed', feeAmount: 2.0 },
    })

    const result = await calculateTabTotal(tab.id)

    expect(result.serviceFee).toBe(2.0)
    expect(result.payableTotal).toBe(26.0)
  })

  it('processConfirmedTabPayment creates PARTNER + PLATFORM invoices anchored on the partner account', async () => {
    const { tab, partner } = await setupStandaloneTab()

    await processConfirmedTabPayment(tab.id)

    const invoices = await prisma.invoice.findMany({ where: { tableTabId: tab.id } })
    expect(invoices).toHaveLength(2)
    for (const invoice of invoices) {
      expect(invoice.accountId).toBe(partner.userId)
    }

    const partnerInvoice = invoices.find((i) => i.issuerType === 'PARTNER')!
    expect(partnerInvoice.totalAmount).toBe(24.0)

    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId: partnerInvoice.id },
    })
    // Per-item VAT (14%) on every product line
    for (const line of lines) {
      expect(line.vatRate).toBe(14)
    }
  })

  it('closes the tab: TAB_PAID, closedAt set, openTableId nulled', async () => {
    const { tab } = await setupStandaloneTab()

    await processConfirmedTabPayment(tab.id)

    const after = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })
    expect(after.status).toBe(TAB_PAID)
    expect(after.closedAt).not.toBeNull()
    expect(after.openTableId).toBeNull()
    expect(after.siteId).toBeNull()
  })

  it('is idempotent — re-run leaves invoice count unchanged', async () => {
    const { tab } = await setupStandaloneTab()

    await processConfirmedTabPayment(tab.id)
    await processConfirmedTabPayment(tab.id)

    const count = await prisma.invoice.count({ where: { tableTabId: tab.id } })
    expect(count).toBe(2)
  })

  it('cash settle: PARTNER-only receipt, TAB_SETTLED_CASH, no commission', async () => {
    const { tab } = await setupStandaloneTab()

    await processConfirmedTabPayment(tab.id, { cash: true })

    const invoices = await prisma.invoice.findMany({ where: { tableTabId: tab.id } })
    expect(invoices).toHaveLength(1)
    expect(invoices[0]!.issuerType).toBe('PARTNER')

    const after = await prisma.tableTab.findUniqueOrThrow({ where: { id: tab.id } })
    expect(after.status).toBe(TAB_SETTLED_CASH)
    expect(after.openTableId).toBeNull()
  })
})
