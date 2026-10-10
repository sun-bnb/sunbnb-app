/**
 * The AEAT QR image for one invoice (track 026 phase 6).
 *
 * ## Why this is a route and not a data URI
 *
 * The emailed receipt is the copy a guest keeps, and Gmail strips inline
 * `data:` images — so the email needs a hosted URL. Rendering it here gives one
 * encoder for all four surfaces (HTML, PDF, email, and any reprint) instead of
 * three that can disagree about error-correction level.
 *
 * ## Why it takes an invoice id and not the payload
 *
 * An endpoint that encodes arbitrary text into a PNG is a free image generator
 * pointed at anything, and one that took `nif`/`numserie`/`importe` as query
 * parameters would happily draw a QR claiming any amount for any tax id. This
 * one looks the invoice up and builds the payload server-side from stored
 * values, so the image can only ever say what the invoice says. It exposes
 * nothing that is not already printed on the receipt.
 *
 * No ownership check, for the same reason: the QR's content is the issuer NIF,
 * the invoice number, the date and the total — all of it on the face of the
 * document — and a guest reaching their receipt without a session is a
 * first-class case here (anonymous POS and dine-in tab flows). Invoice ids are
 * cuids, so the set is not enumerable. Rate-limited as the cost backstop.
 *
 * Phase 6a widened what that covers: a PLATFORM commission invoice now renders
 * too, so the same reasoning has to hold for a partner's commission figure as
 * for a guest's purchase. It does - the payload is still only what is on the
 * face of the document, still reachable only with the exact cuid - but it is a
 * B2B amount rather than a consumer one, so it is worth having said so rather
 * than inheriting the earlier judgement silently.
 */

import { NextRequest, NextResponse } from 'next/server'
import QRCode from 'qrcode'
import prisma from '@repo/data/PrismaCient'
import { rateLimit } from '@repo/data/rate-limit'
import { buildInvoiceQrUrl, QR_IMAGE_SPEC } from '@repo/data/tax/es-verifactu/qr'
import { ES_ISSUER_TIME_ZONE, formatFechaExpedicion } from '@repo/data/tax/es-verifactu/huella'
import { resolveTaxRegime } from '@repo/data/tax/regime'
import { resolveInvoiceIssuerJurisdiction } from '@repo/data/tax/es-verifactu/record'

/** Cuid or uuid, checked before the query so a junk id costs nothing. */
const ID_PATTERN = /^[a-z0-9]{20,32}$|^[0-9a-f-]{36}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const rl = rateLimit(`receipt-qr:${ip}`, { maxAttempts: 120, windowMs: 60 * 1000 })
  if (!rl.allowed) {
    return new NextResponse('Too many requests', { status: 429 })
  }

  const { invoiceId } = await params
  if (!ID_PATTERN.test(invoiceId)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true,
      invoicedAt: true,
      issuerType: true,
      issuerVatNumber: true,
      totalAmount: true,
      account: { select: { country: true, taxRegion: true } },
    },
  })
  if (!invoice) return new NextResponse('Not found', { status: 404 })

  // A non-Spanish issuer has no QR to draw. 404 rather than a blank image: a
  // broken-image icon on a Finnish receipt would look like an outage, and the
  // presenters already omit the element entirely.
  //
  // Resolved through `resolveInvoiceIssuerJurisdiction`, NOT off `account`. On a
  // PLATFORM commission invoice `accountId` is the RECIPIENT partner, so reading
  // the regime there asked the customer's jurisdiction about OUR document: it
  // 404'd the QR for our invoice to the Finnish partner, which Sunbnb España SL
  // owes under art. 20, and would have withdrawn it from a Spanish partner's the
  // moment that partner turned out to be foral. Harmless until phase 6a gave the
  // commission invoice a surface that asks for the image.
  const regime = resolveTaxRegime(resolveInvoiceIssuerJurisdiction(invoice))
  if (regime !== 'ES_VERIFACTU') return new NextResponse('Not found', { status: 404 })

  const qr = buildInvoiceQrUrl({
    issuerNif: invoice.issuerVatNumber ?? '',
    invoiceNumber: invoice.invoiceNumber ?? '',
    fechaExpedicion: formatFechaExpedicion(invoice.invoicedAt, ES_ISSUER_TIME_ZONE),
    totalAmount: invoice.totalAmount,
  })
  if (!qr.ok) {
    console.error(`[Verifactu] QR image for ${invoiceId} not drawn: ${qr.reason}`)
    return new NextResponse('Not found', { status: 404 })
  }

  // Level M is mandated by art. 21.1, not chosen for density.
  //
  // `margin: 0` is deliberate. art. 21.1 measures the CODE at 30–40 mm, and a
  // quiet zone baked into the PNG eats into that: 4 modules a side on a
  // 33-module image leaves the code at ~76% of what is printed, so a 35 mm
  // image would carry a 26 mm code and miss the minimum. The presenters supply
  // the quiet zone as white padding around the image instead, which satisfies
  // §3's 2 mm (6 mm recommended) while letting the code itself be the size the
  // order asks for.
  const png = await QRCode.toBuffer(qr.url, {
    errorCorrectionLevel: QR_IMAGE_SPEC.errorCorrectionLevel,
    type: 'png',
    width: 512,
    margin: 0,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      // An issued invoice is immutable, so this image never changes.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(png.byteLength),
    },
  })
}
