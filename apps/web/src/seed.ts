// Approvals the agents would have raised by the demo date. Until the agents
// exist (next PR), they are seeded from the ledger and the planted edge cases,
// so the inbox shows the decisions a client really faces.

import { addDays, type ISODate } from "@geartrain/rules-engine";
import type { ClientDataset } from "@geartrain/synthetic";
import type { Approval } from "./state.ts";

const pounds = (p: number) => `£${(p / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function seedApprovals(datasets: ClientDataset[], today: ISODate): Approval[] {
  const out: Approval[] = [];
  let n = 0;
  const add = (a: Omit<Approval, "id" | "status" | "raisedBy" | "raisedOn">) =>
    out.push({ ...a, id: `apr-${String(++n).padStart(4, "0")}`, status: "pending", raisedBy: "Geartrain agent", raisedOn: today });

  for (const d of datasets) {
    const key = d.profile.key;
    const supplier = (id: string) => d.contacts.find((c) => c.id === id)?.name ?? id;
    const edge = (kind: string) => d.edgeCases.find((e) => e.kind === kind);
    const flagged = new Set(d.edgeCases.flatMap((e) => e.refs));

    // A payment run: approved bills due in the next fortnight.
    const due = d.bills.filter((b) => b.status === "authorised" && b.dueDate <= addDays(today, 14) && !flagged.has(b.id));
    if (due.length > 0) {
      const total = due.reduce((s, b) => s + b.totalPence - b.payments.reduce((p, x) => p + x.amountPence, 0), 0);
      add({
        clientKey: key,
        kind: "payBills",
        title: `Pay ${due.length} supplier bill${due.length === 1 ? "" : "s"} due by ${addDays(today, 14)}`,
        detail: due.map((b) => `${supplier(b.contactId)} ${b.reference}`).join("; "),
        amountPence: total,
        risk: "externalFinancial",
        warnings: [],
        refs: due.map((b) => b.id),
      });
    }

    const injection = edge("promptInjection");
    if (injection) {
      const bill = d.bills.find((b) => injection.refs.includes(b.id));
      add({
        clientKey: key,
        kind: "approveBill",
        title: `Approve bill ${bill?.reference ?? ""} from ${bill ? supplier(bill.contactId) : "supplier"}`,
        detail: injection.description,
        ...(bill ? { amountPence: bill.totalPence } : {}),
        risk: "externalFinancial",
        warnings: ["The invoice text contains instructions aimed at an AI assistant. They were ignored: no approval was skipped and no bank details were changed."],
        refs: injection.refs,
      });
    }

    const variance = edge("priceVariance");
    if (variance) {
      const bill = d.bills.find((b) => variance.refs.includes(b.id));
      const po = d.purchaseOrders.find((p) => variance.refs.includes(p.id));
      add({
        clientKey: key,
        kind: "approveBill",
        title: `Approve bill ${bill?.reference ?? ""}: 9% above its purchase order`,
        detail: `Purchase order ${po?.number ?? ""} was for ${pounds(po?.netPence ?? 0)} net; the bill is ${pounds(bill?.netPence ?? 0)} net.`,
        ...(bill ? { amountPence: bill.totalPence } : {}),
        risk: "externalFinancial",
        warnings: ["Payment is on hold until the buyer confirms the price change."],
        refs: variance.refs,
      });
    }

    const noPo = edge("billWithoutPurchaseOrder");
    if (noPo) {
      const bill = d.bills.find((b) => noPo.refs.includes(b.id));
      add({
        clientKey: key,
        kind: "approveBill",
        title: `Approve bill ${bill?.reference ?? ""} with no purchase order`,
        detail: noPo.description,
        ...(bill ? { amountPence: bill.totalPence } : {}),
        risk: "externalFinancial",
        warnings: ["Tooling is normally bought on a purchase order. Ask the requester to raise or confirm one."],
        refs: noPo.refs,
      });
    }

    const dup = edge("duplicateBill");
    if (dup) {
      add({
        clientKey: key,
        kind: "discardDuplicate",
        title: "Discard a duplicate supplier invoice",
        detail: dup.description,
        risk: "reversible",
        warnings: [],
        refs: dup.refs,
      });
    }

    const bank = edge("bankDetailsChange");
    if (bank) {
      const contact = d.contacts.find((c) => bank.refs.includes(c.id));
      add({
        clientKey: key,
        kind: "supplierBankDetails",
        title: `Bank details change requested for ${contact?.name ?? "a supplier"}`,
        detail: bank.description,
        risk: "blocked",
        warnings: [
          "The email came from a lookalike domain. This is a common invoice fraud.",
          "Payments to this supplier are on hold. Geartrain never changes bank details from an email.",
        ],
        requiresVerification: "call the supplier on the number already on file (not one in the email) and confirm the change",
        refs: bank.refs,
      });
    }

    const debt = edge("badDebt");
    if (debt) {
      const inv = d.invoices.find((i) => debt.refs.includes(i.id));
      add({
        clientKey: key,
        kind: "sendFinalNotice",
        title: `Send a final notice for invoice ${inv?.number ?? ""}`,
        detail: debt.description,
        ...(inv ? { amountPence: inv.totalPence } : {}),
        risk: "externalFinancial",
        warnings: ["This is the last step before proposing a write-off or a claim."],
        refs: debt.refs,
      });
    }
  }
  return out;
}
