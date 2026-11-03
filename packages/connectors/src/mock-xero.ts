// An in-memory stand-in for Xero, serving one synthetic client's ledger. It
// keeps Xero's real limits (no bank reconciliation over the API; writes land as
// drafts) so agents built against it behave the same against real Xero.

import type { BankLine, Bill, ClientDataset, DocumentFile, SalesInvoice } from "@geartrain/synthetic";
import {
  NotSupportedError,
  type BillDraft,
  type ConnectorWrite,
  type DateRange,
  type InvoiceDraft,
  type LedgerAdapter,
  type UploadedDocument,
} from "./types.ts";

const inRange = (d: string, r: DateRange) => (!r.from || d >= r.from) && (!r.to || d <= r.to);
const clone = <T>(x: T): T => structuredClone(x);

export class MockXero implements LedgerAdapter {
  readonly provider = "mockXero";
  readonly capabilities = { bankReconciliation: false, vatReturnFiling: "inLedger" as const };
  readonly writes: ConnectorWrite[] = [];
  private readonly data: ClientDataset;
  private seq = 0;

  constructor(
    dataset: ClientDataset,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    // A private copy: writes never leak back into the shared dataset.
    this.data = clone(dataset);
  }

  private nextId(kind: string): string {
    this.seq += 1;
    return `${this.data.profile.key}-${kind}-new-${String(this.seq).padStart(4, "0")}`;
  }

  private log(operation: string, ids: string[]) {
    this.writes.push({ at: this.now(), connector: this.provider, operation, ids });
  }

  async listContacts(filter: { kind?: "customer" | "supplier" } = {}) {
    return clone(this.data.contacts.filter((c) => !filter.kind || c.kind === filter.kind));
  }

  async getContact(id: string) {
    return clone(this.data.contacts.find((c) => c.id === id));
  }

  async listInvoices(filter: DateRange & { status?: SalesInvoice["status"][]; contactId?: string } = {}) {
    return clone(
      this.data.invoices.filter(
        (i) => inRange(i.issueDate, filter) && (!filter.status || filter.status.includes(i.status)) && (!filter.contactId || i.contactId === filter.contactId),
      ),
    );
  }

  async listBills(filter: DateRange & { status?: Bill["status"][]; contactId?: string } = {}) {
    return clone(
      this.data.bills.filter(
        (b) => inRange(b.issueDate, filter) && (!filter.status || filter.status.includes(b.status)) && (!filter.contactId || b.contactId === filter.contactId),
      ),
    );
  }

  async listPurchaseOrders(filter: DateRange & { status?: ("billed" | "received" | "open")[] } = {}) {
    return clone(this.data.purchaseOrders.filter((p) => inRange(p.date, filter) && (!filter.status || filter.status.includes(p.status))));
  }

  async listBankLines(filter: DateRange & { unreconciled?: boolean } = {}) {
    return clone(this.data.bankLines.filter((b) => inRange(b.date, filter) && (!filter.unreconciled || !b.reconciled)));
  }

  async getDocument(id: string) {
    return clone(this.data.documents.find((d) => d.id === id));
  }

  async uploadDocument(doc: UploadedDocument): Promise<DocumentFile> {
    if (doc.mimeType !== "text/plain") throw new NotSupportedError("uploadDocument", "the mock stores text documents only");
    const file: DocumentFile = { id: this.nextId("doc"), kind: doc.kind, fileName: doc.fileName, mimeType: "text/plain", receivedOn: doc.receivedOn, content: doc.content };
    this.data.documents.push(file);
    this.log("uploadDocument", [file.id]);
    return clone(file);
  }

  async createDraftBill(draft: BillDraft): Promise<Bill> {
    this.requireContact(draft.contactId, "supplier");
    if (draft.documentId && !this.data.documents.some((d) => d.id === draft.documentId)) throw new Error(`Unknown document ${draft.documentId}`);
    const totals = sumLines(draft.lines);
    const bill: Bill = {
      id: this.nextId("bill"),
      reference: draft.reference,
      contactId: draft.contactId,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      lines: clone(draft.lines),
      ...totals,
      status: "draft",
      ...(draft.purchaseOrderId ? { purchaseOrderId: draft.purchaseOrderId } : {}),
      documentId: draft.documentId ?? "",
      payments: [],
    };
    this.data.bills.push(bill);
    this.log("createDraftBill", [bill.id]);
    return clone(bill);
  }

  async createDraftInvoice(draft: InvoiceDraft): Promise<SalesInvoice> {
    this.requireContact(draft.contactId, "customer");
    const number = `DRAFT-${String(this.data.invoices.length + 1).padStart(5, "0")}`;
    const inv: SalesInvoice = {
      id: this.nextId("invoice"),
      number,
      contactId: draft.contactId,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      lines: clone(draft.lines),
      ...sumLines(draft.lines),
      // A person approves before it is sent (see the approvals inbox).
      status: "draft",
      payments: [],
    };
    this.data.invoices.push(inv);
    this.log("createDraftInvoice", [inv.id]);
    return clone(inv);
  }

  async reconcileBankLine(_bankLineId: string, _match: NonNullable<BankLine["matchedTo"]>): Promise<BankLine> {
    throw new NotSupportedError("reconcileBankLine", "Xero's API cannot reconcile bank statement lines; a person reconciles in Xero");
  }

  private requireContact(id: string, kind: "customer" | "supplier") {
    const c = this.data.contacts.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown contact ${id}`);
    if (c.kind !== kind) throw new Error(`Contact ${id} is a ${c.kind}, not a ${kind}`);
  }
}

function sumLines(lines: { netPence: number; vatPence: number }[]) {
  const netPence = lines.reduce((s, l) => s + l.netPence, 0);
  const vatPence = lines.reduce((s, l) => s + l.vatPence, 0);
  for (const l of lines) if (!Number.isInteger(l.netPence) || !Number.isInteger(l.vatPence)) throw new Error("Amounts must be whole pence");
  return { netPence, vatPence, totalPence: netPence + vatPence };
}
