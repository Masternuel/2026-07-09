const DAY_MS = 24 * 60 * 60 * 1_000;
const EPOCH = "1970-01-01T00:00:00.000Z";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function timestamp(value, fallback = null) {
  const source = value ?? fallback;
  if (source == null || source === "") return null;
  const parsed = source instanceof Date ? source : new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function firstTimestamp(...values) {
  for (const value of values) {
    const parsed = timestamp(value);
    if (parsed) return parsed;
  }
  return null;
}

function addDays(value, days) {
  const parsed = timestamp(value, EPOCH);
  return new Date(new Date(parsed).getTime() + Math.max(0, Math.trunc(Number(days) || 0)) * DAY_MS).toISOString();
}

function daysBetween(start, end) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS));
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function stableId(prefix, ...parts) {
  return `${prefix}-${hash(parts.map(text).join("|"))}`;
}

function normalizedToken(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstObject(...values) {
  return values.find((value) => object(value)) ?? {};
}

function currentDate(room, supplied) {
  return firstTimestamp(
    supplied,
    room?.professionalLifecycleState?.currentDate,
    room?.clubCareerState?.currentDate,
    room?.coachEmploymentState?.currentDate,
    room?.currentDate,
    room?.seasonStartedAt,
    room?.startedAt,
    room?.createdAt,
    EPOCH,
  );
}

function lifecycleId(record) {
  return text(record?.id);
}

function contractId(record) {
  return text(record?.contractId ?? record?.legacyContractId ?? record?.metadata?.contractId);
}

function sameProfessional(left, right) {
  return left?.professionalType === right?.professionalType
    && text(left?.professionalId) === text(right?.professionalId);
}

function sortByIdentity(values) {
  return [...values].sort((left, right) => [
    text(left?.professionalType),
    text(left?.professionalId),
    text(left?.startDate ?? left?.announcedAt ?? left?.proposedAt ?? left?.occurredAt),
    text(left?.id),
  ].join("|").localeCompare([
    text(right?.professionalType),
    text(right?.professionalId),
    text(right?.startDate ?? right?.announcedAt ?? right?.proposedAt ?? right?.occurredAt),
    text(right?.id),
  ].join("|")));
}

function latestFirst(values) {
  return [...values].sort((left, right) => {
    const leftDate = firstTimestamp(left?.updatedAt, left?.endedAt, left?.endDate, left?.startDate, EPOCH);
    const rightDate = firstTimestamp(right?.updatedAt, right?.endedAt, right?.endDate, right?.startDate, EPOCH);
    return rightDate.localeCompare(leftDate) || text(left?.id).localeCompare(text(right?.id));
  });
}

function isMutualAgreement(value) {
  const token = normalizedToken(value);
  return token === "mutual_agreement"
    || token === "agreement_mutual"
    || token === "acordo_mutuo"
    || token === "mutual_separation"
    || token === "separated_by_agreement"
    || token.includes("mutual_agreement")
    || token.includes("acordo_mutuo")
    || token.includes("separated_by_agreement");
}

function isRetirement(value) {
  const token = normalizedToken(value);
  return token === "retirement" || token === "retired" || token === "aposentadoria" || token === "aposentado"
    || token.includes("retirement") || token.includes("aposentador");
}

function uniqueById(values) {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function findEntity(entities, id) {
  return entities.find((candidate) => text(candidate?.id) === id) ?? null;
}

function buildDescriptors(room) {
  const descriptors = [];
  const coaches = array(room?.coachCareerState?.coaches);
  const coachContracts = array(room?.coachEmploymentState?.contracts);
  const coachAppointments = array(room?.coachEmploymentState?.appointments);
  const coachIds = new Set([
    ...coaches.map((value) => text(value?.id)),
    ...coachContracts.map((value) => text(value?.coachId)),
    ...coachAppointments.map((value) => text(value?.coachId)),
  ].filter(Boolean));

  for (const id of [...coachIds].sort()) {
    descriptors.push({
      professionalType: "coach",
      professionalId: id,
      entity: findEntity(coaches, id),
      contracts: latestFirst(coachContracts.filter((value) => text(value?.coachId) === id)),
      appointments: latestFirst(coachAppointments.filter((value) => text(value?.coachId) === id)),
      history: [
        ...array(room?.coachEmploymentState?.events),
        ...array(room?.coachEmploymentState?.history),
        ...array(room?.coachEmploymentState?.timeline),
      ].filter((value) => text(value?.coachId ?? value?.professionalId) === id),
    });
  }

  const staffMembers = array(room?.clubCareerState?.staffMembers);
  const staffCandidates = array(room?.clubCareerState?.staffCandidates);
  const staffEntities = [...staffMembers, ...staffCandidates.filter((candidate) => (
    !staffMembers.some((member) => text(member?.id) === text(candidate?.id))
  ))];
  const staffContracts = array(room?.clubCareerState?.staffContracts);
  const staffHistory = array(room?.clubCareerState?.staffHistory);
  const staffIds = new Set([
    ...staffEntities.map((value) => text(value?.id)),
    ...staffContracts.map((value) => text(value?.staffId)),
    ...staffHistory.map((value) => text(value?.staffId ?? value?.professionalId)),
  ].filter(Boolean));

  for (const id of [...staffIds].sort()) {
    descriptors.push({
      professionalType: "staff",
      professionalId: id,
      entity: findEntity(staffEntities, id),
      contracts: latestFirst(staffContracts.filter((value) => text(value?.staffId) === id)),
      appointments: [],
      history: staffHistory.filter((value) => text(value?.staffId ?? value?.professionalId) === id),
    });
  }
  return descriptors;
}

function preferredContract(descriptor, predicate) {
  return descriptor.contracts.find(predicate)
    ?? descriptor.contracts.find((contract) => contract?.status === "active")
    ?? descriptor.contracts[0]
    ?? null;
}

function contextFor(descriptor, contract = null) {
  const entity = descriptor.entity ?? {};
  const appointment = descriptor.appointments.find((value) => value?.status === "active")
    ?? descriptor.appointments[0]
    ?? {};
  return {
    clubId: text(contract?.clubId ?? appointment?.clubId ?? entity?.currentClubId ?? entity?.clubId) || null,
    role: text(contract?.role ?? appointment?.role ?? entity?.role)
      || (descriptor.professionalType === "coach" ? "head_coach" : "staff"),
  };
}

function hasExistingNotice(existing, candidate) {
  return array(existing?.notices).some((record) => (
    lifecycleId(record) === candidate.id
    || (sameProfessional(record, candidate) && (
      (contractId(record) && contractId(record) === candidate.contractId)
      || record?.status === "active"
    ))
  ));
}

function hasExistingRetirement(existing, candidate) {
  return array(existing?.retirements).some((record) => (
    lifecycleId(record) === candidate.id
    || (sameProfessional(record, candidate) && (
      (contractId(record) && contractId(record) === candidate.contractId)
      || ["scheduled", "effective"].includes(record?.status)
    ))
  ));
}

function hasExistingAgreement(existing, candidate) {
  return array(existing?.mutualAgreements).some((record) => (
    lifecycleId(record) === candidate.id
    || (sameProfessional(record, candidate) && (
      (contractId(record) && contractId(record) === candidate.contractId)
      || (
        firstTimestamp(record?.executedAt, record?.departureDate, record?.proposedAt)
          === candidate.executedAt
        && text(record?.clubId) === text(candidate.clubId)
      )
    ))
  ));
}

function buildNotice(descriptor, now) {
  const entity = descriptor.entity ?? {};
  const contract = preferredContract(descriptor, (value) => (
    normalizedToken(value?.lifecycleStatus) === "notice" || text(value?.noticeId)
  ));
  const embedded = firstObject(entity?.noticePeriod, entity?.notice, contract?.noticePeriod, contract?.notice);
  const status = normalizedToken(entity?.status);
  const availabilityStatus = normalizedToken(entity?.availability?.status);
  const contractLifecycle = normalizedToken(contract?.lifecycleStatus);
  if (!(status === "notice" || availabilityStatus === "notice" || contractLifecycle === "notice"
    || normalizedToken(embedded?.status) === "active")) return null;

  const context = contextFor(descriptor, contract);
  const startDate = firstTimestamp(
    embedded?.startDate,
    embedded?.communicatedAt,
    entity?.noticeStartedAt,
    contract?.noticeStartedAt,
    contract?.noticeStartDate,
    entity?.updatedAt,
    contract?.updatedAt,
    now,
  );
  const explicitDuration = Math.max(0, integer(
    embedded?.durationDays ?? entity?.noticeDurationDays ?? contract?.noticeDurationDays,
    30,
  ));
  const expectedEndDate = firstTimestamp(
    embedded?.expectedEndDate,
    embedded?.endDate,
    entity?.noticeEndDate,
    contract?.noticeEndDate,
    entity?.availability?.availableFrom,
    entity?.availability?.effectiveAt,
    addDays(startDate, explicitDuration),
  );
  const id = text(embedded?.id ?? entity?.noticeId ?? contract?.noticeId)
    || stableId("legacy-professional-notice", descriptor.professionalType, descriptor.professionalId, contract?.id, startDate);
  return {
    ...clone(embedded),
    id,
    operationId: text(embedded?.operationId) || `legacy-migration:${id}`,
    professionalType: descriptor.professionalType,
    professionalId: descriptor.professionalId,
    role: context.role,
    clubId: context.clubId,
    contractId: text(contract?.id) || null,
    initiatedBy: ["professional", "club", "mutual"].includes(embedded?.initiatedBy)
      ? embedded.initiatedBy
      : "mutual",
    reason: text(embedded?.reason ?? entity?.availability?.reason ?? contract?.noticeReason) || "legacy_notice",
    communicatedAt: firstTimestamp(embedded?.communicatedAt, startDate),
    startDate,
    durationDays: daysBetween(startDate, expectedEndDate),
    expectedEndDate,
    endedAt: null,
    earlyExitAllowed: embedded?.earlyExitAllowed !== false,
    interviewAllowed: embedded?.interviewAllowed !== false,
    longTermDecisionApprovalRequired: embedded?.longTermDecisionApprovalRequired !== false,
    earlyExitReasons: array(embedded?.earlyExitReasons).map(text).filter(Boolean),
    compensation: clone(embedded?.compensation ?? entity?.availability?.compensation ?? {}),
    status: "active",
    endReason: null,
    successorSearchId: text(embedded?.successorSearchId) || null,
    substituteCoachId: text(embedded?.substituteCoachId) || null,
    updatedAt: firstTimestamp(embedded?.updatedAt, entity?.updatedAt, contract?.updatedAt, startDate),
    migration: { source: "legacy_status", contractId: text(contract?.id) || null },
  };
}

function buildRetirement(descriptor, now) {
  const entity = descriptor.entity ?? {};
  const contract = preferredContract(descriptor, (value) => {
    const lifecycle = normalizedToken(value?.lifecycleStatus);
    return ["retirement_pending", "retiring", "retired"].includes(lifecycle)
      || isRetirement(value?.endReason)
      || text(value?.retirementId);
  });
  const embedded = firstObject(entity?.retirement, entity?.retirementPlan, contract?.retirement, contract?.retirementPlan);
  const entityStatus = normalizedToken(entity?.status);
  const availabilityStatus = normalizedToken(entity?.availability?.status);
  const contractLifecycle = normalizedToken(contract?.lifecycleStatus);
  const effective = entityStatus === "retired" || availabilityStatus === "retired"
    || contractLifecycle === "retired" || isRetirement(contract?.endReason)
    || normalizedToken(embedded?.status) === "effective";
  const scheduled = entityStatus === "retiring" || availabilityStatus === "retiring"
    || ["retirement_pending", "retiring"].includes(contractLifecycle)
    || normalizedToken(embedded?.status) === "scheduled";
  if (!effective && !scheduled) return null;

  const context = contextFor(descriptor, contract);
  const effectiveAt = firstTimestamp(
    embedded?.effectiveAt,
    embedded?.effectiveDate,
    entity?.retirementDate,
    contract?.retirementDate,
    entity?.availability?.effectiveAt,
    effective ? contract?.endedAt : contract?.endDate,
    effective ? entity?.updatedAt : null,
    now,
  );
  const announcedAt = firstTimestamp(
    embedded?.announcedAt,
    entity?.retirementAnnouncedAt,
    contract?.retirementAnnouncedAt,
    contract?.updatedAt,
    entity?.updatedAt,
    effectiveAt,
  );
  const id = text(embedded?.id ?? entity?.retirementId ?? contract?.retirementId)
    || stableId("legacy-professional-retirement", descriptor.professionalType, descriptor.professionalId, contract?.id, announcedAt);
  const contractEnd = timestamp(contract?.endDate);
  const explicitKind = normalizedToken(embedded?.kind ?? embedded?.retirementType);
  const kind = ["future", "end_season", "end_contract", "immediate"].includes(explicitKind)
    ? explicitKind
    : (!effective && contractEnd === effectiveAt ? "end_contract" : (effective ? "immediate" : "future"));
  return {
    ...clone(embedded),
    id,
    operationId: text(embedded?.operationId) || `legacy-migration:${id}`,
    professionalType: descriptor.professionalType,
    professionalId: descriptor.professionalId,
    role: context.role,
    clubId: context.clubId,
    contractId: text(contract?.id) || null,
    kind,
    announcedAt,
    effectiveAt,
    status: effective ? "effective" : "scheduled",
    reason: text(embedded?.reason ?? entity?.availability?.reason ?? contract?.endReason) || "legacy_retirement",
    cancelledAt: null,
    effectiveDate: effective ? effectiveAt : null,
    postponementCount: Math.max(0, integer(embedded?.postponementCount, 0)),
    previousEffectiveDates: array(embedded?.previousEffectiveDates).map(timestamp).filter(Boolean),
    decisionFactors: object(embedded?.decisionFactors) ? clone(embedded.decisionFactors) : {},
    staffDecisions: clone(embedded?.staffDecisions ?? embedded?.commissionDecisions ?? []),
    successorSearchId: text(embedded?.successorSearchId) || null,
    updatedAt: firstTimestamp(embedded?.updatedAt, entity?.updatedAt, contract?.updatedAt, effectiveAt),
    migration: { source: "legacy_status", contractId: text(contract?.id) || null },
  };
}

function evidenceFrom(value, source, defaultContractId = null) {
  if (!value || typeof value !== "object") return null;
  const marker = [value?.endReason, value?.exitReason, value?.reason, value?.type, value?.eventType, value?.action]
    .find(isMutualAgreement);
  if (!marker && normalizedToken(value?.lifecycleStatus) !== "mutual_agreement") return null;
  const metadata = object(value?.metadata) ?? {};
  const terms = firstObject(value?.terms, value?.agreementTerms, metadata?.agreementTerms);
  return {
    source,
    contractId: text(value?.contractId ?? metadata?.contractId ?? defaultContractId) || null,
    agreementId: text(value?.mutualAgreementId ?? value?.agreementId ?? metadata?.agreementId) || null,
    clubId: text(value?.clubId ?? metadata?.clubId) || null,
    role: text(value?.role ?? metadata?.role) || null,
    proposedAt: firstTimestamp(value?.proposedAt, value?.createdAt, metadata?.proposedAt),
    occurredAt: firstTimestamp(
      value?.executedAt,
      value?.endedAt,
      value?.departureDate,
      value?.occurredAt,
      value?.date,
      value?.updatedAt,
    ),
    reason: text(value?.reason ?? value?.endReason ?? value?.exitReason ?? marker) || "mutual_agreement",
    compensation: Math.max(0, integer(
      terms?.compensation ?? terms?.agreedCompensation ?? value?.compensation ?? value?.amount ?? metadata?.amount,
      0,
    )),
    terms: clone(terms),
    signatures: clone(value?.signatures ?? metadata?.signatures ?? {}),
    acceptedAt: firstTimestamp(value?.acceptedAt, metadata?.acceptedAt),
    signedAt: firstTimestamp(value?.signedAt, metadata?.signedAt),
  };
}

function mutualEvidence(descriptor) {
  const entity = descriptor.entity ?? {};
  const evidence = [];
  for (const contract of descriptor.contracts) {
    const item = evidenceFrom(contract, "contract", contract?.id);
    if (item) evidence.push(item);
  }
  for (const appointment of descriptor.appointments) {
    const item = evidenceFrom(appointment, "appointment", appointment?.contractId);
    if (item) evidence.push(item);
  }
  for (const assignment of array(entity?.assignments)) {
    const item = evidenceFrom(assignment, "assignment", assignment?.contractId);
    if (item) evidence.push(item);
  }
  for (const spell of array(entity?.professionalHistory)) {
    const item = evidenceFrom(spell, "professional_history", spell?.contractId);
    if (item) evidence.push(item);
  }
  for (const event of [
    ...descriptor.history,
    ...array(entity?.careerTimeline),
    ...array(entity?.careerConductHistory),
    ...array(entity?.negotiationHistory),
  ]) {
    const item = evidenceFrom(event, "history", event?.contractId);
    if (item) evidence.push(item);
  }
  return evidence.filter((item) => item.occurredAt);
}

function mergeEvidence(target, incoming) {
  target.contractId ||= incoming.contractId;
  target.agreementId ||= incoming.agreementId;
  target.clubId ||= incoming.clubId;
  target.role ||= incoming.role;
  target.proposedAt ||= incoming.proposedAt;
  target.occurredAt ||= incoming.occurredAt;
  target.reason ||= incoming.reason;
  target.compensation = Math.max(target.compensation ?? 0, incoming.compensation ?? 0);
  target.terms = { ...(target.terms ?? {}), ...(incoming.terms ?? {}) };
  target.signatures = { ...(target.signatures ?? {}), ...(incoming.signatures ?? {}) };
  target.acceptedAt ||= incoming.acceptedAt;
  target.signedAt ||= incoming.signedAt;
  target.sources = [...new Set([...(target.sources ?? []), incoming.source])].sort();
  return target;
}

function groupedMutualEvidence(descriptor) {
  const groups = [];
  const values = mutualEvidence(descriptor).sort((left, right) => (
    left.occurredAt.localeCompare(right.occurredAt)
    || text(left.contractId).localeCompare(text(right.contractId))
    || text(left.source).localeCompare(text(right.source))
  ));
  for (const value of values) {
    const matching = groups.find((group) => (
      (group.contractId && value.contractId && group.contractId === value.contractId)
      || (group.occurredAt === value.occurredAt && text(group.clubId) === text(value.clubId))
    ));
    if (matching) mergeEvidence(matching, value);
    else groups.push(mergeEvidence({}, value));
  }
  return groups;
}

function buildAgreement(descriptor, evidence) {
  const matchingContract = evidence.contractId
    ? descriptor.contracts.find((value) => text(value?.id) === evidence.contractId)
    : null;
  const context = contextFor(descriptor, matchingContract);
  const executedAt = evidence.occurredAt;
  const proposedAt = firstTimestamp(evidence.proposedAt, evidence.acceptedAt, evidence.signedAt, executedAt);
  const id = evidence.agreementId || stableId(
    "legacy-professional-mutual",
    descriptor.professionalType,
    descriptor.professionalId,
    evidence.contractId,
    executedAt,
  );
  const acceptedAt = firstTimestamp(evidence.acceptedAt, evidence.proposedAt, executedAt);
  const signedAt = firstTimestamp(evidence.signedAt, evidence.acceptedAt, executedAt);
  const clubSignature = firstTimestamp(evidence.signatures?.club, signedAt);
  const professionalSignature = firstTimestamp(evidence.signatures?.professional, signedAt);
  return {
    id,
    operationId: `legacy-migration:${id}`,
    professionalType: descriptor.professionalType,
    professionalId: descriptor.professionalId,
    role: evidence.role || context.role,
    clubId: evidence.clubId || context.clubId,
    contractId: evidence.contractId,
    proposedBy: "club",
    nextResponder: "club",
    status: "executed",
    proposedAt,
    expiresAt: executedAt,
    departureDate: executedAt,
    reason: evidence.reason || "mutual_agreement",
    staffDecisions: [],
    terms: { ...(evidence.terms ?? {}), compensation: evidence.compensation ?? 0 },
    negotiationRound: 1,
    decisionHistory: [],
    signatures: {
      club: clubSignature,
      professional: professionalSignature,
    },
    acceptedAt,
    signedAt,
    executedAt,
    rejectedAt: null,
    updatedAt: executedAt,
    migration: {
      source: evidence.sources,
      contractId: evidence.contractId,
      signatureInferredFromExecution: !evidence.signatures?.club || !evidence.signatures?.professional,
    },
  };
}

function transitionFor(record, kind) {
  const startedAt = record.startDate ?? record.announcedAt ?? record.proposedAt;
  const endedAt = kind === "notice"
    ? record.endedAt
    : (kind === "retirement" ? record.effectiveDate : record.executedAt);
  const expectedEndAt = kind === "notice"
    ? record.expectedEndDate
    : (kind === "retirement" ? record.effectiveAt : record.departureDate);
  const active = (kind === "notice" && record.status === "active")
    || (kind === "retirement" && record.status === "scheduled");
  return {
    id: stableId("legacy-professional-transition", kind, record.id),
    operationId: record.operationId,
    type: kind === "notice" ? "notice_period" : (kind === "retirement" ? "retirement_transition" : "mutual_separation"),
    clubId: record.clubId,
    coachId: record.professionalType === "coach" ? record.professionalId : null,
    professionalIds: [record.professionalId],
    startedAt,
    expectedEndAt,
    endedAt: endedAt ?? null,
    status: active ? "active" : "completed",
    metadata: {
      lifecycleId: record.id,
      professionalType: record.professionalType,
      contractId: record.contractId,
      migratedFromLegacy: true,
    },
  };
}

function timelineFor(record, kind, event = null) {
  const effectiveEvent = event === "effective";
  const occurredAt = effectiveEvent
    ? record.effectiveAt
    : (kind === "notice" ? record.communicatedAt : (kind === "retirement" ? record.announcedAt : record.executedAt));
  const type = kind === "notice"
    ? "PROFESSIONAL_NOTICE_STARTED"
    : (kind === "retirement"
      ? (effectiveEvent ? "PROFESSIONAL_RETIREMENT_EFFECTIVE" : "PROFESSIONAL_RETIREMENT_ANNOUNCED")
      : "PROFESSIONAL_MUTUAL_SEPARATION_EXECUTED");
  return {
    id: stableId("legacy-professional-timeline", type, record.id),
    operationId: record.operationId,
    lifecycleId: record.id,
    type,
    professionalType: record.professionalType,
    professionalId: record.professionalId,
    role: record.role,
    clubId: record.clubId,
    startedAt: record.startDate ?? record.announcedAt ?? record.proposedAt,
    endedAt: effectiveEvent ? record.effectiveAt : (record.endedAt ?? record.executedAt ?? null),
    occurredAt,
    initiatedBy: record.initiatedBy ?? record.proposedBy ?? null,
    reason: record.reason,
    financialImpact: kind === "agreement" ? -Math.max(0, integer(record.terms?.compensation, 0)) : 0,
    reputationImpact: 0,
    relatedProfessionalIds: [],
    metadata: { contractId: record.contractId, migratedFromLegacy: true },
  };
}

function filterAuditDuplicates(values, existingValues) {
  const ids = new Set(array(existingValues).map((value) => text(value?.id)).filter(Boolean));
  const lifecycleEvents = new Set(array(existingValues).map((value) => (
    `${text(value?.type)}|${text(value?.lifecycleId ?? value?.metadata?.lifecycleId)}`
  )));
  return values.filter((value) => (
    !ids.has(value.id)
    && !lifecycleEvents.has(`${text(value.type)}|${text(value.lifecycleId ?? value?.metadata?.lifecycleId)}`)
  ));
}

/**
 * Reconstructs only missing professional lifecycle records from legacy save fields.
 * Pure and deterministic: no clock, random value, write, or mutation of the supplied room.
 */
export function migrateLegacyProfessionalLifecycle(roomValue, options = {}) {
  if (!roomValue || typeof roomValue !== "object" || Array.isArray(roomValue)) {
    throw new TypeError("Save legado invalido");
  }
  const room = clone(roomValue);
  const now = currentDate(room, options.now);
  const existing = object(room.professionalLifecycleState) ?? {};
  const descriptors = buildDescriptors(room);

  const notices = [];
  const retirements = [];
  const mutualAgreements = [];
  for (const descriptor of descriptors) {
    const notice = buildNotice(descriptor, now);
    if (notice && !hasExistingNotice(existing, notice)) notices.push(notice);

    const retirement = buildRetirement(descriptor, now);
    if (retirement && !hasExistingRetirement(existing, retirement)) retirements.push(retirement);

    for (const evidence of groupedMutualEvidence(descriptor)) {
      const agreement = buildAgreement(descriptor, evidence);
      if (!hasExistingAgreement(existing, agreement)) mutualAgreements.push(agreement);
    }
  }

  const sortedNotices = sortByIdentity(uniqueById(notices));
  const sortedRetirements = sortByIdentity(uniqueById(retirements));
  const sortedAgreements = sortByIdentity(uniqueById(mutualAgreements));
  const transitions = filterAuditDuplicates([
    ...sortedNotices.map((record) => transitionFor(record, "notice")),
    ...sortedRetirements.map((record) => transitionFor(record, "retirement")),
    ...sortedAgreements.map((record) => transitionFor(record, "agreement")),
  ], existing.transitions);
  const timeline = filterAuditDuplicates([
    ...sortedNotices.map((record) => timelineFor(record, "notice")),
    ...sortedRetirements.flatMap((record) => [
      timelineFor(record, "retirement"),
      ...(record.status === "effective" ? [timelineFor(record, "retirement", "effective")] : []),
    ]),
    ...sortedAgreements.map((record) => timelineFor(record, "agreement")),
  ], existing.timeline);
  const processedOperationIds = [...new Set([
    ...sortedNotices,
    ...sortedRetirements,
    ...sortedAgreements,
  ].map((record) => record.operationId).filter(Boolean))].sort();

  return {
    version: 1,
    currentDate: now,
    notices: sortedNotices,
    retirements: sortedRetirements,
    mutualAgreements: sortedAgreements,
    transitions: sortByIdentity(transitions),
    timeline: sortByIdentity(timeline),
    processedOperationIds,
  };
}

export const reconstructLegacyProfessionalLifecycle = migrateLegacyProfessionalLifecycle;
