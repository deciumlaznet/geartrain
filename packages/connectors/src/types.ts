// What Geartrain needs from the outside world, as interfaces. The mocks in this
// package serve the synthetic clients; real Xero, HMRC and Companies House
// clients will implement the same interfaces, so the worker, the web app and
// the agents never know which they are talking to.

import type {
  BankLine,
  Bill,
  Contact,
  DocumentFile,
  ISODate,
  LineItem,
  PurchaseOrder,
  SalesInvoice,
} from "@geartrain/synthetic";

export interface DateRange {
  from?: ISODate;
  to?: ISODate;
}

/** Thrown when the real service cannot do something, so callers route it to a person. */
export class NotSupportedError extends Error {
  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`${operation} is not supported: ${reason}`);
    this.name = "NotSupportedError";
  }
}

export interface BillDraft {
  contactId: string;
  reference: string;
  issueDate: ISODate;
  dueDate: ISODate;
  lines: LineItem[];
  purchaseOrderId?: string;
  documentId?: string;
}

export interface InvoiceDraft {
  contactId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  lines: LineItem[];
}

export interface UploadedDocument {
  fileName: string;
  mimeType: string;
  content: string;
  receivedOn: ISODate;
  kind: DocumentFile["kind"];
}

/** One entry per call that changes something, for the audit trail. */
export interface ConnectorWrite {
  at: string;
  connector: string;
  operation: string;
  ids: string[];
}

/**
 * The accounting ledger. Xero first; later Sage, FreeAgent, Business Central.
 * Writes create drafts: approving and paying stay with people (see the approvals inbox).
 */
export interface LedgerAdapter {
  readonly provider: string;
  readonly capabilities: {
    /** Xero's API cannot reconcile bank statement lines; a person does it in Xero. */
    bankReconciliation: boolean;
    /** Where VAT returns are filed: in the ledger, or by Geartrain direct to HMRC. */
    vatReturnFiling: "inLedger" | "direct";
  };
  listContacts(filter?: { kind?: Contact["kind"] }): Promise<Contact[]>;
  getContact(id: string): Promise<Contact | undefined>;
  listInvoices(filter?: DateRange & { status?: SalesInvoice["status"][]; contactId?: string }): Promise<SalesInvoice[]>;
  listBills(filter?: DateRange & { status?: Bill["status"][]; contactId?: string }): Promise<Bill[]>;
  listPurchaseOrders(filter?: DateRange & { status?: PurchaseOrder["status"][] }): Promise<PurchaseOrder[]>;
  listBankLines(filter?: DateRange & { unreconciled?: boolean }): Promise<BankLine[]>;
  getDocument(id: string): Promise<DocumentFile | undefined>;
  uploadDocument(doc: UploadedDocument): Promise<DocumentFile>;
  createDraftBill(draft: BillDraft): Promise<Bill>;
  createDraftInvoice(draft: InvoiceDraft): Promise<SalesInvoice>;
  reconcileBankLine(bankLineId: string, match: NonNullable<BankLine["matchedTo"]>): Promise<BankLine>;
}

/** HMRC obligations, modelled on the VAT and Income Tax (MTD) obligations APIs. */
export interface TaxObligation {
  regime: "vat" | "itsaQuarterly" | "selfAssessment" | "corporationTax" | "paye";
  periodKey: string;
  start: ISODate;
  end: ISODate;
  due: ISODate;
  /** O = open, F = fulfilled, as HMRC returns it. */
  status: "O" | "F";
  received?: ISODate;
}

export interface TaxAuthority {
  readonly sandbox: boolean;
  obligations(filter?: DateRange & { status?: "O" | "F"; regime?: TaxObligation["regime"] }): Promise<TaxObligation[]>;
  /** Geartrain never replies to HMRC itself; in the pilot, returns are filed in Xero or by the client. */
  submitReturn(regime: TaxObligation["regime"], periodKey: string): Promise<never>;
}

export interface CompanyProfile {
  companyNumber: string;
  companyName: string;
  incorporatedOn: ISODate;
  registeredOffice: string;
  accounts: { lastMadeUpTo?: ISODate; nextMadeUpTo: ISODate; nextDue: ISODate; overdue: boolean };
  confirmationStatement: { lastMadeUpTo?: ISODate; nextMadeUpTo: ISODate; nextDue: ISODate; overdue: boolean };
}

export interface FilingHistoryItem {
  date: ISODate;
  type: "AA" | "CS01" | "IN01";
  description: string;
  madeUpTo?: ISODate;
}

export interface CompanyRegistry {
  profile(companyNumber: string): Promise<CompanyProfile | undefined>;
  filingHistory(companyNumber: string): Promise<FilingHistoryItem[]>;
}
