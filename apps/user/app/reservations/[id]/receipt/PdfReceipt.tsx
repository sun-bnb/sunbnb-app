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
    <Document>
      <Page size="A5" style={styles.page}>

        {/* Header / Business Info */}
        <View style={styles.headerSection}>
          <Text>{receipt.company}</Text>
          <Text>{receipt.businessId}</Text>
          <Text>{receipt.phoneNumber}</Text>
        </View>

        {/* Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={[styles.tableRow, { fontWeight: 'bold', paddingBottom: '8px'}]}>
            <Text style={styles.tableCell1}>Item</Text>
            <Text style={styles.tableCell2}>Charge</Text>
            <Text style={styles.tableCell3}>VAT</Text>
            <Text style={styles.tableCell4}>Price</Text>
          </View>

          {/* Table Body */}
          {receipt.invoiceLines.map((line, index) => {

            let description = line.description || ''

            if (description.length > 50) {
              description = description.substring(0, 50) + '...';
            }

            return (
              <View style={[styles.tableRow, { marginBottom: 5 }]} key={index}>
                <Text style={[styles.tableCell1, { paddingRight: 20 }]}>
                  {description}
                </Text>
                <Text style={styles.tableCell2}>{line.charge}</Text>
                <Text style={styles.tableCell3}>{line.vat}</Text>
                <Text style={styles.tableCell4}>{line.total} €</Text>
              </View>
            );
          })}

          {/* Extra row for spacing */}
          <View style={styles.tableRow}>
            <Text style={styles.tableCell1} />
          </View>

          {/* Totals Row */}
          <View style={[styles.tableRow, styles.totalRow, { marginTop: 10 } ]}>
            <Text style={[styles.tableCell1, { paddingRight: '10px', fontWeight: 'bold' }]}>Total:</Text>
            <Text style={styles.tableCell2}>{receipt.totalCharge}</Text>
            <Text style={styles.tableCell3}>{receipt.totalVat}</Text>
            <Text style={styles.tableCell4}>{receipt.totalAmount} €</Text>
          </View>
        </View>

        {/* Footer / Date */}
        <View style={styles.centerText}>
          <Text>{receipt.date}</Text>
        </View>
      </Page>
    </Document>
  )


}