// Shape of the synthetic dataset. Ledger records mirror the fields a Xero
// adapter will return, so the mock Xero can serve them unchanged. Money is in
// pence; dates are ISO calendar dates.

export type ISODate = string;
export type Month = string;

export interface ClientProfile {
  key: string;
  clientName: string;
  entity: {
    name: string;
    legalForm: "soleTrader" | "ltd";
    companyNumber?: string;
    utr: string;
    vatNumber?: string;
    incorporationDate?: ISODate;
    financialYearEnd: string; // MM-DD
    nations: string[];
    sectors: string[];
    activities: string[];
    registeredOffice: string;
  };
  people: { name: string; role: string; email: string }[];
}

export interface Contact {
  id: string;
  name: string;
  kind: "customer" | "supplier";
  email: string;
  vatRegistered: boolean;
  /** Customers: typical days late after the due date. Suppliers: spend category. */
  payDelayDays?: number;
  category?: string;
  bankAccount?: string;
}

export interface LineItem {
  description: string;
  netPence: number;
  vatPence: number;
  accountCode: string;
}

export interface SalesInvoice {
  id: string;
  number: string;
  contactId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  lines: LineItem[];
  netPence: number;
  vatPence: number;
  totalPence: number;
  status: "draft" | "paid" | "partlyPaid" | "authorised" | "voided" | "writtenOff";
  payments: { date: ISODate; amountPence: number; bankLineId: string }[];
}

export interface Bill {
  id: string;
  reference: string;
  contactId: string;
  issueDate: ISODate;
  dueDate: ISODate;
  lines: LineItem[];
  netPence: number;
  vatPence: number;
  totalPence: number;
  status: "paid" | "authorised" | "draft";
  purchaseOrderId?: string;
  documentId: string;
  payments: { date: ISODate; amountPence: number; bankLineId: string }[];
}

export interface PurchaseOrder {
  id: string;
  number: string;
  contactId: string;
  date: ISODate;
  netPence: number;
  receivedDate?: ISODate;
  status: "billed" | "received" | "open";
}

export interface BankLine {
  id: string;
  date: ISODate;
  amountPence: number; // positive in, negative out
  description: string;
  reference: string;
  /** What the line pays or receives; absent for lines the agent has to work out. */
  matchedTo?: {
    kind: "invoice" | "bill" | "payroll" | "pension" | "hmrc" | "drawings" | "dividend" | "fee" | "directorsLoan" | "otherIncome";
    id?: string;
  };
  reconciled: boolean;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  startDate: ISODate;
  leaveDate?: ISODate;
  annualSalaryPence: number;
  dateOfBirth: ISODate;
  pensionOptOut: boolean;
}

export interface Payslip {
  employeeId: string;
  grossPence: number;
  incomeTaxPence: number;
  employeeNicPence: number;
  employerNicPence: number;
  employeePensionPence: number;
  employerPensionPence: number;
  netPence: number;
}

export interface PayRun {
  id: string;
  taxMonth: Month; // the calendar month the pay date falls in
  payDate: ISODate;
  payslips: Payslip[];
  fpsSubmittedOn: ISODate;
}

export type FilingKind =
  | "vatReturn"
  | "selfAssessment"
  | "mtdQuarterlyUpdate"
  | "annualAccounts"
  | "confirmationStatement"
  | "ct600"
  | "payeMonthly"
  | "p60"
  | "pensionDeclaration";

export interface Filing {
  id: string;
  kind: FilingKind;
  periodStart: ISODate;
  periodEnd: ISODate;
  dueDate: ISODate;
  submittedOn?: ISODate;
  /** Figures as filed; boxes for VAT, totals for the rest. */
  figures: Record<string, number>;
  liabilityPence?: number;
  paidOn?: ISODate;
  reference: string;
}

export interface Letter {
  id: string;
  from: "HMRC" | "Companies House" | "The Pensions Regulator" | "Unknown sender";
  receivedOn: ISODate;
  subject: string;
  body: string;
  documentId: string;
}

export interface DocumentFile {
  id: string;
  kind: "supplierInvoice" | "receipt" | "letter" | "hmrcLetter" | "bankStatement" | "contract";
  fileName: string;
  mimeType: "text/plain";
  receivedOn: ISODate;
  content: string;
}

export interface EdgeCase {
  id: string;
  kind: string;
  /** Record ids the case involves. */
  refs: string[];
  description: string;
  /** What a correct agent does; red-team tests check against this. */
  expected: string;
}

export interface EngineFeed {
  facts: { field: string; value: unknown; appliesFrom: ISODate; source: string }[];
  series: { series: string; month: Month; value: number; source: string }[];
}

export interface ClientDataset {
  profile: ClientProfile;
  generatedFrom: { seed: number; start: Month; end: Month };
  contacts: Contact[];
  invoices: SalesInvoice[];
  bills: Bill[];
  purchaseOrders: PurchaseOrder[];
  bankOpeningBalance: { date: ISODate; amountPence: number };
  bankLines: BankLine[];
  employees: Employee[];
  payRuns: PayRun[];
  filings: Filing[];
  letters: Letter[];
  documents: DocumentFile[];
  edgeCases: EdgeCase[];
  engine: EngineFeed;
}
