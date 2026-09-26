import type { ReceiptDetail } from '@/lib/api/endpoints/receipts';
import { centsInput } from './format';

export function receiptFormOf(receipt: ReceiptDetail) {
  return {
    issuer: receipt.issuer ?? '',
    invoiceNumber: receipt.invoiceNumber ?? '',
    invoiceDate: receipt.invoiceDate ?? '',
    dueDate: receipt.dueDate ?? '',
    gross: centsInput(receipt.totalGrossCents),
    vat: centsInput(receipt.vatCents),
    currency: receipt.currency,
    iban: receipt.iban ?? '',
    direction: receipt.direction,
  };
}
