/** One booked or pending line of a bank statement. Amounts are signed cents (debits negative). */
export interface BankEntry {
  bookingDate: string;
  valueDate: string | null;
  amountCents: number;
  currency: string;
  counterpartyName: string;
  counterpartyIban: string | null;
  purpose: string;
  endToEndId: string | null;
  mandateId: string | null;
  creditorId: string | null;
  bankReference: string | null;
  bankCode: string | null;
  bookingText: string | null;
  status: 'booked' | 'pending';
}

export interface BankStatement {
  format: 'camt052' | 'camt053' | 'camt054' | 'csv';
  accountIban: string | null;
  currency: string | null;
  from: string | null;
  to: string | null;
  openingCents: number | null;
  closingCents: number | null;
  entries: BankEntry[];
  warnings: string[];
}

/** Thrown when an input is not a bank statement or e-invoice this package understands. */
export class FinanceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FinanceParseError';
  }
}
