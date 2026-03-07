import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet
} from '@react-pdf/renderer'
import { ReceiptProps } from './ReceiptPage'

function fmt(value: number): string {
  return value.toFixed(2)
}

export default function PdfReceipt({ receipt }: { receipt: ReceiptProps }) {

  const SafeDocument = Document as unknown as React.ComponentType<any>
  const SafePage = Page as unknown as React.ComponentType<any>
  const SafeText = Text as unknown as React.ComponentType<any>
  const SafeView = View as unknown as React.ComponentType<any>

  const s = StyleSheet.create({
    page: {
      padding: 24,
      fontSize: 10,
      color: '#1f2937',
      fontFamily: 'Helvetica',
    },
    header: {
      textAlign: 'center',
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: '#e5e7eb',
      marginBottom: 12,
    },
    companyName: {
      fontSize: 14,
      fontWeight: 'bold',
      color: '#111827',
    },
    subText: {
      fontSize: 8,
      color: '#9ca3af',
      marginTop: 2,
    },
    // Reservation info section
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
    // Table
    table: {
      width: '100%',
      marginBottom: 12,
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
    // Totals
    totalsSection: {
      borderTopWidth: 1,
      borderTopColor: '#d1d5db',
      paddingTop: 8,
    },
    totalLine: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 3,
    },
    totalLabel: {
      fontSize: 9,
      color: '#6b7280',
    },
    totalValue: {
      fontSize: 9,
      color: '#6b7280',
    },
    grandTotalLine: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: '#e5e7eb',
      paddingTop: 5,
      marginTop: 3,
    },
    grandTotalLabel: {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#111827',
    },
    grandTotalValue: {
      fontSize: 11,
      fontWeight: 'bold',
      color: '#111827',
    },
    footer: {
      textAlign: 'center',
      marginTop: 20,
      fontSize: 8,
      color: '#9ca3af',
    },
  })

  const hasInfo = receipt.siteName || receipt.reservationDate || receipt.seatNumbers

  return (
    <SafeDocument>
      <SafePage size="A5" style={s.page}>

        {/* Header */}
        <SafeView style={s.header}>
          <SafeText style={s.companyName}>{receipt.company}</SafeText>
          {receipt.businessId ? <SafeText style={s.subText}>{receipt.businessId}</SafeText> : null}
          {receipt.companyAddress ? <SafeText style={s.subText}>{receipt.companyAddress}</SafeText> : null}
          {receipt.phoneNumber ? <SafeText style={s.subText}>{receipt.phoneNumber}</SafeText> : null}
        </SafeView>

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

        {/* Table */}
        <SafeView style={s.table}>
          {/* Header row */}
          <SafeView style={s.tableHeaderRow}>
            <SafeText style={[s.col1, s.headerText]}>Item</SafeText>
            <SafeText style={[s.col2, s.headerText]}>Charge</SafeText>
            <SafeText style={[s.col3, s.headerText]}>VAT</SafeText>
            <SafeText style={[s.col4, s.headerText]}>Price</SafeText>
          </SafeView>

          {/* Body rows */}
          {receipt.invoiceLines.map((line, index) => {
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

        {/* Totals */}
        <SafeView style={s.totalsSection}>
          <SafeView style={s.totalLine}>
            <SafeText style={s.totalLabel}>Subtotal</SafeText>
            <SafeText style={s.totalValue}>{fmt(receipt.totalCharge)} €</SafeText>
          </SafeView>
          <SafeView style={s.totalLine}>
            <SafeText style={s.totalLabel}>VAT</SafeText>
            <SafeText style={s.totalValue}>{fmt(receipt.totalVat)} €</SafeText>
          </SafeView>
          <SafeView style={s.grandTotalLine}>
            <SafeText style={s.grandTotalLabel}>Total</SafeText>
            <SafeText style={s.grandTotalValue}>{fmt(receipt.totalAmount)} €</SafeText>
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
