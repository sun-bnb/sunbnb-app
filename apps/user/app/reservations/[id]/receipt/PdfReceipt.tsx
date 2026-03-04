import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet
} from '@react-pdf/renderer'
import { ReceiptProps } from './ReceiptPage'

export default function PdfReceipt({ receipt }: { receipt: ReceiptProps }) {

  const SafeDocument = Document as unknown as React.ComponentType<any>
  const SafePage = Page as unknown as React.ComponentType<any>
  const SafeText = Text as unknown as React.ComponentType<any>
  const SafeView = View as unknown as React.ComponentType<any>

  const styles = StyleSheet.create({
    page: {
      padding: 10,
      fontSize: 12,
    },

    // For the "header" or business info
    headerSection: {
      textAlign: 'center',
      marginBottom: 36,
    },

    // For your table
    table: {
      width: '100%',
      marginBottom: 20,
    },
    tableRow: {
      width: '100%',
      display: 'flex',
      flexDirection: 'row'
    },
    tableCell1: {
      width: '55%'
    },
    tableCell2: {
      width: '15%'
    },
    tableCell3: {
      width: '15%'
    },
    tableCell4: {
      width: '15%',
      textAlign: 'right'
    },

    // Additional utility styling
    totalRow: {
    },
    centerText: {
      textAlign: 'center',
    }

  })

  return (
    <SafeDocument>
      <SafePage size="A5" style={styles.page}>

        {/* Header / Business Info */}
        <SafeView style={styles.headerSection}>
          <SafeText>{receipt.company}</SafeText>
          <SafeText>{receipt.businessId}</SafeText>
          {receipt.phoneNumber ? <SafeText>{receipt.phoneNumber}</SafeText> : null}
          {receipt.issuerType === 'PLATFORM' && (
            <SafeText style={{ fontSize: 9, marginTop: 6, color: '#7c3aed' }}>
              Issued by platform
            </SafeText>
          )}
          {receipt.settlementId && (
            <SafeText style={{ fontSize: 8, marginTop: 3, color: '#9ca3af' }}>
              Settlement ref: {receipt.settlementId}
            </SafeText>
          )}
        </SafeView>

        {/* Table */}
        <SafeView style={styles.table}>
          {/* Table Header */}
          <SafeView style={[styles.tableRow, { fontWeight: 'bold', paddingBottom: '8px'}]}>
            <SafeText style={styles.tableCell1}>Item</SafeText>
            <SafeText style={styles.tableCell2}>Charge</SafeText>
            <SafeText style={styles.tableCell3}>VAT</SafeText>
            <SafeText style={styles.tableCell4}>Price</SafeText>
          </SafeView>

          {/* Table Body */}
          {receipt.invoiceLines.map((line, index) => {

            let description = line.description || ''

            if (description.length > 50) {
              description = description.substring(0, 50) + '...';
            }

            return (
              <SafeView style={[styles.tableRow, { marginBottom: 5 }]} key={index}>
                <SafeText style={[styles.tableCell1, { paddingRight: 20 }]}>
                  {description}
                </SafeText>
                <SafeText style={styles.tableCell2}>{line.charge}</SafeText>
                <SafeText style={styles.tableCell3}>{line.vat}</SafeText>
                <SafeText style={styles.tableCell4}>{line.total} €</SafeText>
              </SafeView>
            );
          })}

          {/* Extra row for spacing */}
          <SafeView style={styles.tableRow}>
            <SafeText style={styles.tableCell1} />
          </SafeView>

          {/* Totals Row */}
          <SafeView style={[styles.tableRow, styles.totalRow, { marginTop: 10 } ]}>
            <SafeText style={[styles.tableCell1, { paddingRight: '10px', fontWeight: 'bold' }]}>Total:</SafeText>
            <SafeText style={styles.tableCell2}>{receipt.totalCharge}</SafeText>
            <SafeText style={styles.tableCell3}>{receipt.totalVat}</SafeText>
            <SafeText style={styles.tableCell4}>{receipt.totalAmount} €</SafeText>
          </SafeView>
        </SafeView>

        {/* Footer / Date */}
        <SafeView style={styles.centerText}>
          <SafeText>{receipt.date}</SafeText>
        </SafeView>
      </SafePage>
    </SafeDocument>
  )


}
