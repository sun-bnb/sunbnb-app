import React from 'react'
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'
import { ReceiptProps, InvoiceSection } from './ReceiptPage'

function fmt(value: number): string {
  return value.toFixed(2)
}

const s = StyleSheet.create({
  page: {
    padding: 24,
    fontSize: 10,
    color: '#1f2937',
    fontFamily: 'Helvetica',
  },
  // Info section
  infoSection: {
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    borderBottomStyle: 'dashed' as any,
  },
  infoRow: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  infoLabel: {
    fontSize: 8,
    color: '#9ca3af',
  },
  infoValue: {
    fontSize: 8,
    color: '#1f2937',
    fontWeight: 'bold',
  },
  // Merchant section
  sectionWrapper: {
    marginBottom: 10,
  },
  sectionLabel: {
    fontSize: 7,
    color: '#9ca3af',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  merchantHeader: {
    textAlign: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    marginBottom: 8,
  },
  companyName: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#111827',
  },
  subText: {
    fontSize: 8,
    color: '#9ca3af',
    marginTop: 2,
  },
  invoiceNum: {
    fontSize: 7,
    color: '#9ca3af',
    marginTop: 3,
  },
  // Table
  table: {
    width: '100%',
    marginBottom: 8,
  },
  tableHeaderRow: {
    display: 'flex',
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    display: 'flex',
    flexDirection: 'row',
    paddingVertical: 2,
  },
  tableRowAlt: {
    backgroundColor: '#fafafa',
  },
  col1: { width: '46%' },
  col2: { width: '18%', textAlign: 'right' },
  col3: { width: '18%', textAlign: 'right' },
  col4: { width: '18%', textAlign: 'right' },
  headerText: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#6b7280',
  },
  cellText: {
    fontSize: 9,
    color: '#374151',
  },
  cellBold: {
    fontSize: 9,
    color: '#111827',
    fontWeight: 'bold',
  },
  // Subtotals
  subtotalsSection: {
    borderTopWidth: 1,
    borderTopColor: '#d1d5db',
    paddingTop: 6,
  },
  subtotalLine: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  subtotalLabel: {
    fontSize: 8,
    color: '#6b7280',
  },
  subtotalValue: {
    fontSize: 8,
    color: '#6b7280',
  },
  sectionTotalLine: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    paddingTop: 4,
    marginTop: 2,
  },
  sectionTotalLabel: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#374151',
  },
  sectionTotalValue: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#374151',
  },
  // Grand total
  grandTotalSection: {
    borderTopWidth: 2,
    borderTopColor: '#6b7280',
    paddingTop: 8,
    marginTop: 4,
  },
  grandTotalLine: {
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  grandTotalLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#111827',
  },
  grandTotalValue: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#111827',
  },
  // Footer
  footer: {
    textAlign: 'center',
    marginTop: 16,
    fontSize: 8,
    color: '#9ca3af',
  },
})

function SectionPdf({
  section,
  label,
  SafeView,
  SafeText,
}: {
  section: InvoiceSection
  label?: string
  SafeView: React.ComponentType<any>
  SafeText: React.ComponentType<any>
}) {
  return (
    <SafeView style={s.sectionWrapper}>
      {/* Label */}
      {label && <SafeText style={s.sectionLabel}>{label}</SafeText>}

      {/* Merchant header */}
      <SafeView style={s.merchantHeader}>
        <SafeText style={s.companyName}>{section.merchantName}</SafeText>
        {section.merchantVatId ? (
          <SafeText style={s.subText}>{section.merchantVatId}</SafeText>
        ) : null}
        {section.merchantAddress ? (
          <SafeText style={s.subText}>{section.merchantAddress}</SafeText>
        ) : null}
        {section.merchantPhone ? (
          <SafeText style={s.subText}>{section.merchantPhone}</SafeText>
        ) : null}
        {section.invoiceNumber ? (
          <SafeText style={s.invoiceNum}>Invoice {section.invoiceNumber}</SafeText>
        ) : null}
      </SafeView>

      {/* Table */}
      <SafeView style={s.table}>
        <SafeView style={s.tableHeaderRow}>
          <SafeText style={[s.col1, s.headerText]}>Item</SafeText>
          <SafeText style={[s.col2, s.headerText]}>Charge</SafeText>
          <SafeText style={[s.col3, s.headerText]}>VAT</SafeText>
          <SafeText style={[s.col4, s.headerText]}>Price</SafeText>
        </SafeView>
        {section.lines.map((line, index) => {
          let description = line.description || ''
          if (description.length > 40) {
            description = description.substring(0, 40) + '...'
          }
          return (
            <SafeView
              style={[s.tableRow, index % 2 === 0 ? s.tableRowAlt : {}]}
              key={index}
            >
              <SafeText style={[s.col1, s.cellText]}>{description}</SafeText>
              <SafeText style={[s.col2, s.cellText]}>{fmt(line.charge)}</SafeText>
              <SafeText style={[s.col3, s.cellText]}>{fmt(line.vat)}</SafeText>
              <SafeText style={[s.col4, s.cellBold]}>{fmt(line.total)} €</SafeText>
            </SafeView>
          )
        })}
      </SafeView>

      {/* Subtotals */}
      <SafeView style={s.subtotalsSection}>
        <SafeView style={s.subtotalLine}>
          <SafeText style={s.subtotalLabel}>Subtotal</SafeText>
          <SafeText style={s.subtotalValue}>{fmt(section.subtotalCharge)} €</SafeText>
        </SafeView>
        <SafeView style={s.subtotalLine}>
          <SafeText style={s.subtotalLabel}>VAT</SafeText>
          <SafeText style={s.subtotalValue}>{fmt(section.subtotalVat)} €</SafeText>
        </SafeView>
        <SafeView style={s.sectionTotalLine}>
          <SafeText style={s.sectionTotalLabel}>Total</SafeText>
          <SafeText style={s.sectionTotalValue}>{fmt(section.subtotalAmount)} €</SafeText>
        </SafeView>
      </SafeView>
    </SafeView>
  )
}

export default function PdfReceipt({ receipt }: { receipt: ReceiptProps }) {
  const SafeDocument = Document as unknown as React.ComponentType<any>
  const SafePage = Page as unknown as React.ComponentType<any>
  const SafeText = Text as unknown as React.ComponentType<any>
  const SafeView = View as unknown as React.ComponentType<any>

  const hasInfo = receipt.siteName || receipt.reservationDate || receipt.seatNumbers

  return (
    <SafeDocument>
      <SafePage size="A5" style={s.page}>
        {/* Reservation info */}
        {hasInfo && (
          <SafeView style={s.infoSection}>
            {receipt.siteName && (
              <SafeView style={s.infoRow}>
                <SafeText style={s.infoLabel}>Location</SafeText>
                <SafeText style={s.infoValue}>{receipt.siteName}</SafeText>
              </SafeView>
            )}
            {receipt.reservationDate && (
              <SafeView style={s.infoRow}>
                <SafeText style={s.infoLabel}>Date</SafeText>
                <SafeText style={s.infoValue}>{receipt.reservationDate}</SafeText>
              </SafeView>
            )}
            {receipt.seatNumbers && (
              <SafeView style={s.infoRow}>
                <SafeText style={s.infoLabel}>Seats</SafeText>
                <SafeText style={s.infoValue}>{receipt.seatNumbers}</SafeText>
              </SafeView>
            )}
          </SafeView>
        )}

        {/* Partner section */}
        <SectionPdf
          section={receipt.partnerSection}
          label="Service Provider"
          SafeView={SafeView}
          SafeText={SafeText}
        />

        {/* Platform section */}
        {receipt.platformSection && (
          <SectionPdf
            section={receipt.platformSection}
            label="Platform Fee"
            SafeView={SafeView}
            SafeText={SafeText}
          />
        )}

        {/* Grand total */}
        <SafeView style={s.grandTotalSection}>
          <SafeView style={s.grandTotalLine}>
            <SafeText style={s.grandTotalLabel}>Total Paid</SafeText>
            <SafeText style={s.grandTotalValue}>{fmt(receipt.grandTotal)} €</SafeText>
          </SafeView>
        </SafeView>

        {/* Footer */}
        <SafeView style={s.footer}>
          <SafeText>{receipt.date}</SafeText>
        </SafeView>
      </SafePage>
    </SafeDocument>
  )
}
