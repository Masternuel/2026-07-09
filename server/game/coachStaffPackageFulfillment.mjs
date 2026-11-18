import {
  ensureCoachEmploymentState,
  validateCoachEmploymentState,
} from "./coachEmployment.mjs";
import { hireCoachStaffPackage } from "./professionalLifecycle.mjs";
import { renewStaffContract, setStaffCoachLink } from "./staffEngine.mjs";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function clubKey(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function timestamp(value) {
  const parsed = new Date(value ?? Date.now());
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function pendingCommitments(room) {
  const guarantees = room?.coachEmploymentState?.guarantees ?? [];
  const guaranteeById = new Map(guarantees.map((guarantee) => [guarantee.id, guarantee]));
  return (room?.coachEmploymentState?.contracts ?? []).flatMap((contract) => {
    if (contract?.status !== "active") return [];
    return (contract.staffPackageCommitments ?? []).flatMap((commitment, index) => {
      if (commitment?.action !== "hire_coach_staff_package"
        || commitment.status === "fulfilled") return [];
      const guarantee = guaranteeById.get(commitment.guaranteeId);
      if (!guarantee || guarantee.status !== "formalized") return [];
      return [{ contract, commitment, commitmentIndex: index, guarantee }];
    });
  });
}

function activeStaffContractAtClub(room, staffId, clubId, now) {
  const nowMs = new Date(now).getTime();
  return (room?.clubCareerState?.staffContracts ?? []).find((contract) => (
    text(contract?.staffId) === staffId
      && clubKey(contract?.clubId) === clubKey(clubId)
      && contract?.status === "active"
      && (!contract.endDate || new Date(contract.endDate).getTime() > nowMs)
  )) ?? null;
}

function staffMember(room, staffId) {
  return [
    ...(room?.clubCareerState?.staffMembers ?? []),
    ...(room?.clubCareerState?.staffCandidates ?? []),
  ].find((member) => text(member?.id) === staffId) ?? null;
}

function appendGuaranteeDecision(guarantee, now, operationId, metadata) {
  const decision = {
    id: `${operationId}:decision`,
    action: "guarantee_fulfilled",
    responsibleId: "system",
    responsibleRole: "system",
    previousStatus: guarantee.status,
    newStatus: "fulfilled",
    decidedAt: now,
    justification: "coach_staff_package_hired",
    negotiatedValues: clone(metadata),
    conditions: [],
    operationId,
  };
  const history = Array.isArray(guarantee.history) ? guarantee.history : [];
  if (!history.some((entry) => entry.id === decision.id)) history.push(decision);
  guarantee.history = history.slice(-100);
  guarantee.decisionHistory = clone(guarantee.history);
}

function fulfillRecord(room, entry, now, operationId, hiredStaffIds, linkedStaffIds, options) {
  const state = room.coachEmploymentState;
  const contract = state.contracts.find((candidate) => candidate.id === entry.contract.id);
  const guarantee = state.guarantees.find((candidate) => candidate.id === entry.guarantee.id);
  if (!contract || !guarantee) return;
  const commitment = contract.staffPackageCommitments?.[entry.commitmentIndex];
  if (!commitment) return;
  const metadata = {
    contractId: contract.id,
    guaranteeId: guarantee.id,
    staffIds: [...new Set([...hiredStaffIds, ...linkedStaffIds])],
  };
  commitment.status = "fulfilled";
  commitment.fulfilledAt = now;
  commitment.fulfillmentOperationId = operationId;
  guarantee.status = "fulfilled";
  guarantee.updatedAt = now;
  guarantee.completedAt = now;
  appendGuaranteeDecision(guarantee, now, operationId, metadata);
  state.processedOperationIds = [...new Set([
    ...(state.processedOperationIds ?? []),
    operationId,
  ])].slice(-1_000);
  options.recordCareerEvent?.(room, {
    id: `${operationId}:event`,
    operationId,
    type: "COACH_STAFF_PACKAGE_GUARANTEE_FULFILLED",
    occurredAt: now,
    professionalType: "coach",
    professionalId: contract.coachId,
    coachId: contract.coachId,
    clubId: contract.clubId,
    contractId: contract.id,
    metadata,
  });
}

/**
 * Executes every formalized staff-package promise attached to an active coach
 * contract. The input save is never mutated; throwing aborts the whole batch.
 */
export function fulfillCoachStaffPackageCommitments(roomValue, options = {}) {
  const initialPending = pendingCommitments(roomValue);
  if (initialPending.length === 0) {
    return { room: roomValue, fulfilled: [], duplicate: true };
  }
  const now = timestamp(options.now ?? roomValue?.coachEmploymentState?.currentDate);
  let room = ensureCoachEmploymentState(roomValue, { now });
  const fulfilled = [];
  const callbacks = {
    credits: [],
    debits: [],
    coachEvents: [],
    staffTransactions: [],
    careerEvents: [],
  };
  const delegatedOptions = {
    ...options,
    credit: (_room, transaction) => callbacks.credits.push(clone(transaction)),
    debit: (_room, transaction) => callbacks.debits.push(clone(transaction)),
    recordEvent: (_room, event) => callbacks.coachEvents.push(clone(event)),
    postFinancialTransaction: (_room, transaction) => callbacks.staffTransactions.push(clone(transaction)),
    recordCareerEvent: (_room, event) => callbacks.careerEvents.push(clone(event)),
  };

  for (const initialEntry of initialPending) {
    const entry = pendingCommitments(room).find((candidate) => (
      candidate.contract.id === initialEntry.contract.id
        && candidate.guarantee.id === initialEntry.guarantee.id
    ));
    if (!entry) continue;
    const coachId = text(entry.contract.coachId);
    const clubId = text(entry.contract.clubId);
    const operationId = `coach-staff-package-fulfill:${entry.guarantee.id}`;
    const members = (entry.commitment.members ?? entry.commitment.staffIds?.map((staffId) => ({ staffId })) ?? [])
      .map((member) => ({
        ...clone(member),
        staffId: text(member?.staffId),
        wage: member?.wage ?? member?.monthlyCost,
        affiliationType: member?.affiliationType ?? "personal_team",
      }))
      .filter((member) => member.staffId);
    if (members.length === 0) {
      throw new Error(`Pacote de comissao ${entry.guarantee.id} nao possui profissionais`);
    }

    const alreadyAtClub = [];
    const membersToHire = [];
    for (const memberInput of members) {
      const member = staffMember(room, memberInput.staffId);
      const activeContract = activeStaffContractAtClub(room, memberInput.staffId, clubId, now);
      if (member && activeContract && clubKey(member.clubId) === clubKey(clubId)) {
        const promisedWage = Number(memberInput.wage ?? memberInput.monthlyCost ?? 0);
        if (promisedWage > 0 && Number(activeContract.wage ?? 0) < promisedWage) {
          const renewed = renewStaffContract(room, {
            staffId: memberInput.staffId,
            clubId,
            operationId: `${operationId}:terms:${memberInput.staffId}`,
            years: memberInput.years ?? 2,
            wage: promisedWage,
            renewalBonus: memberInput.signingBonus ?? 0,
          }, delegatedOptions);
          room = renewed.room;
        }
        if (text(member.linkedCoachId) !== coachId
          || !["personal_team", "personal_staff"].includes(text(member.affiliationType))) {
          const linked = setStaffCoachLink(room, {
            staffId: memberInput.staffId,
            coachId,
            clubId,
            affiliationType: "personal_team",
            operationId: `${operationId}:link:${memberInput.staffId}`,
          }, delegatedOptions);
          room = linked.room;
        }
        alreadyAtClub.push(memberInput.staffId);
      } else {
        membersToHire.push(memberInput);
      }
    }

    let hiredStaffIds = [];
    if (membersToHire.length > 0) {
      const hired = hireCoachStaffPackage(room, {
        operationId,
        coachId,
        clubId,
        members: membersToHire,
        maximumFirstYearCost: entry.commitment.maximumFirstYearCost
          ?? entry.commitment.firstYearCost,
        initiatedBy: "coach_contract_guarantee",
      }, delegatedOptions);
      room = hired.room;
      hiredStaffIds = (hired.members ?? []).map((member) => text(member?.id)).filter(Boolean);
    }

    fulfillRecord(
      room,
      entry,
      now,
      operationId,
      hiredStaffIds,
      alreadyAtClub,
      delegatedOptions,
    );
    fulfilled.push({
      operationId,
      contractId: entry.contract.id,
      guaranteeId: entry.guarantee.id,
      coachId,
      clubId,
      staffIds: [...new Set([...hiredStaffIds, ...alreadyAtClub])],
    });
  }

  validateCoachEmploymentState(room, { now });
  for (const transaction of callbacks.credits) options.credit?.(room, clone(transaction));
  for (const transaction of callbacks.debits) options.debit?.(room, clone(transaction));
  for (const event of callbacks.coachEvents) options.recordEvent?.(room, clone(event));
  for (const transaction of callbacks.staffTransactions) {
    options.postFinancialTransaction?.(room, clone(transaction));
  }
  for (const event of callbacks.careerEvents) options.recordCareerEvent?.(room, clone(event));
  return { room, fulfilled: clone(fulfilled), duplicate: false };
}
