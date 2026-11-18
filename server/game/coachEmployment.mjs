// Coach employment rules. The implementation is split by workflow under
// ./coachEmployment/ (audit Q-02); this file keeps the public API stable.
export {
  CoachEmploymentError,
  ensureCoachEmploymentState,
  coachEmploymentSnapshot,
  validateCoachEmploymentState,
} from "./coachEmployment/state.mjs";
export {
  appointCoach,
  confirmInterimCoach,
  dismissCoach,
  resignCoach,
  separateCoachByAgreement,
  retireCoach,
  openCoachSuccession,
  previewCoachResignation,
} from "./coachEmployment/appointments.mjs";
export {
  createCoachProposal,
  respondCoachProposal,
  respondCoachBoardDecision,
  renewCoachContract,
} from "./coachEmployment/proposals.mjs";
export {
  applyForCoachVacancy,
  respondCoachInterview,
  applyCoachInterviewGeneratedTurn,
} from "./coachEmployment/recruitment.mjs";
export {
  processCoachEmploymentDate,
} from "./coachEmployment/dailyProcessing.mjs";
