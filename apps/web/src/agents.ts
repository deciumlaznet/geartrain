// Runs the intake agent on a newly uploaded document and records what it did:
// draft bills and flags go in the audit trail, anything a person must decide
// goes in the approvals inbox. Runs in the background so the upload returns at once.

import { runCreditControl, runIntake, type Model, type Proposal } from "@geartrain/agents";
import type { DocumentFile } from "@geartrain/synthetic";
import type { Approval, ClientState, DemoState } from "./state.ts";

export const AGENT_ACTOR = "Geartrain intake agent";

function nextApprovalId(state: DemoState) {
  const max = state.approvals.reduce((m, a) => Math.max(m, Number(a.id.slice(4)) || 0), 0);
  return `apr-${String(max + 1).padStart(4, "0")}`;
}

function raise(state: DemoState, a: Omit<Approval, "id" | "status" | "raisedBy" | "raisedOn">): Approval {
  const approval: Approval = { ...a, id: nextApprovalId(state), status: "pending", raisedBy: AGENT_ACTOR, raisedOn: state.today };
  state.approvals.push(approval);
  return approval;
}

function fromProposal(state: DemoState, clientKey: string, doc: DocumentFile, p: Proposal): Approval {
  if (p.tool === "change_supplier_bank_details") {
    return raise(state, {
      clientKey,
      kind: "supplierBankDetails",
      title: `Bank-details change requested in ${doc.fileName}`,
      detail: `The document asks for payments to go to ${String(p.input.newAccountAsWritten)}. Nothing has been changed.`,
      risk: "blocked",
      warnings: ["Requests to change bank details are the most common invoice fraud. Do not use contact details from the document."],
      refs: [doc.id, String(p.input.contactId)],
      requiresVerification: "Call the supplier on the number already in your records and confirm the change.",
    });
  }
  return raise(state, {
    clientKey,
    kind: "approveBill",
    title: `Approve bill ${String(p.input.billId ?? "")} for payment`,
    detail: `Proposed by the intake agent from ${doc.fileName}.`,
    risk: p.risk,
    warnings: [],
    refs: [doc.id, ...(p.input.billId ? [String(p.input.billId)] : [])],
  });
}

export async function processDocument(state: DemoState, model: Model, cs: ClientState, doc: DocumentFile): Promise<void> {
  const clientKey = cs.data.profile.key;
  const note = { documentId: doc.id, clientKey, status: "working" as const, draftBillIds: [] as string[], approvalIds: [] as string[] };
  state.agentNotes.set(doc.id, note);
  try {
    const r = await runIntake({ model, ledger: cs.xero, document: doc, clientName: cs.data.profile.entity.name, today: state.today });
    const approvals: Approval[] = r.run.proposals.map((p) => fromProposal(state, clientKey, doc, p));
    for (const f of r.flags) {
      approvals.push(
        raise(state, {
          clientKey,
          kind: "reviewDocument",
          title: `Check ${doc.fileName}`,
          detail: f.reason,
          risk: "reversible",
          warnings: f.warnings,
          refs: [doc.id],
        }),
      );
    }
    for (const id of r.draftBillIds) state.audit.push({ at: state.now(), actor: AGENT_ACTOR, clientKey, action: "bill.drafted", refs: [id, doc.id] });
    for (const a of approvals) state.audit.push({ at: state.now(), actor: AGENT_ACTOR, clientKey, action: "approval.raised", refs: [a.id, doc.id], detail: a.title });
    state.agentNotes.set(doc.id, { ...note, status: "done", summary: r.run.finalText || "Done.", draftBillIds: r.draftBillIds, approvalIds: approvals.map((a) => a.id) });
  } catch (e) {
    console.error(`Intake agent failed on ${doc.id}:`, e);
    state.audit.push({ at: state.now(), actor: AGENT_ACTOR, clientKey, action: "agent.failed", refs: [doc.id] });
    state.agentNotes.set(doc.id, { ...note, status: "failed", summary: "The agent could not process this document. A person will pick it up." });
  }
}

export const CREDIT_ACTOR = "Geartrain credit control agent";

/** Runs credit control for one client: reminders are drafted, each send waits for approval. */
export async function processCreditControl(state: DemoState, model: Model, cs: ClientState): Promise<void> {
  const clientKey = cs.data.profile.key;
  state.creditRuns.set(clientKey, { status: "working" });
  try {
    const r = await runCreditControl({ model, ledger: cs.xero, clientName: cs.data.profile.entity.name, today: state.today });
    const raised: Approval[] = [];
    for (const d of r.drafts) {
      const send = r.run.proposals.find((p) => p.tool === "propose_send" && p.input.invoiceId === d.invoiceId);
      const owed = (await cs.xero.listInvoices({ status: ["authorised", "partlyPaid"] })).find((i) => i.id === d.invoiceId);
      const approval = send
        ? raise(state, {
            clientKey,
            kind: d.stage === "final" ? "sendFinalNotice" : "sendReminder",
            title: `Send ${d.stage} reminder for invoice ${d.invoiceNumber} to ${d.to}`,
            detail: `${d.subject}\n\n${d.body}\n\nWhy: ${String(send.input.reason)}`,
            ...(owed ? { amountPence: owed.totalPence - owed.payments.reduce((s, p) => s + p.amountPence, 0) } : {}),
            risk: "externalFinancial",
            warnings: d.stage === "final" ? ["A final notice is the last step before a write-off or a claim."] : [],
            refs: [d.invoiceId],
          })
        : undefined;
      if (approval) raised.push(approval);
      state.reminders.push({ clientKey, invoiceId: d.invoiceId, invoiceNumber: d.invoiceNumber, to: d.to, stage: d.stage, subject: d.subject, body: d.body, draftedOn: state.today, ...(approval ? { approvalId: approval.id } : {}) });
      state.audit.push({ at: state.now(), actor: CREDIT_ACTOR, clientKey, action: "reminder.drafted", refs: [d.invoiceId], detail: d.subject });
    }
    for (const p of r.run.proposals.filter((x) => x.tool === "add_late_payment_interest")) {
      raised.push(
        raise(state, {
          clientKey,
          kind: "lateInterest",
          title: `Consider late-payment interest on invoice ${String(p.input.invoiceId)}`,
          detail: "The agent suggests claiming statutory interest and compensation under the Late Payment of Commercial Debts Act. Agents never add it themselves.",
          risk: "blocked",
          warnings: ["Claiming interest can end a customer relationship. Check the contract terms first."],
          refs: [String(p.input.invoiceId)],
          requiresVerification: "Confirm the contract allows it and that the customer has been warned.",
        }),
      );
    }
    for (const a of raised) state.audit.push({ at: state.now(), actor: CREDIT_ACTOR, clientKey, action: "approval.raised", refs: [a.id, ...a.refs], detail: a.title });
    state.creditRuns.set(clientKey, { status: "done", summary: r.run.finalText || "Done." });
  } catch (e) {
    console.error(`Credit control failed for ${clientKey}:`, e);
    state.audit.push({ at: state.now(), actor: CREDIT_ACTOR, clientKey, action: "agent.failed", refs: [] });
    state.creditRuns.set(clientKey, { status: "failed", summary: "Credit control could not finish. Nothing was sent." });
  }
}
