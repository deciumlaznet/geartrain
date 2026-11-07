// Runs the intake agent on a newly uploaded document and records what it did:
// draft bills and flags go in the audit trail, anything a person must decide
// goes in the approvals inbox. Runs in the background so the upload returns at once.

import { runIntake, type Model, type Proposal } from "@geartrain/agents";
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
