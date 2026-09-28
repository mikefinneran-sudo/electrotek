import type { ClientModule } from "@waltersignal/bananaforce-core";

export const FORENSIC_CASE_MODULE_ID = "forensic-case";

export const forensicCaseModule = {
  id: FORENSIC_CASE_MODULE_ID,
  name: "Forensic Case",
  description:
    "Evidence, claimants, case participants, depositions, contact details, and time billing for forensic-engineering matters.",
  routes: ["/api/forensic-case", "/cases"],
  dataAdapters: ["supabase"],
  audience: "staff",
  requires: ["crm"],
} satisfies ClientModule;

export type {
  Address,
  AddressInput,
  CaseClaimant,
  CaseEvidence,
  CaseParticipant,
  CaseTimeEntry,
  ClaimantInput,
  ContactMethod,
  ContactMethodInput,
  ContactMethodKind,
  Deposition,
  DepositionInput,
  EvidenceInput,
  ForensicEntity,
  ParticipantInput,
  ParticipantType,
  TimeEntryInput,
} from "./types";
export {
  CONTACT_METHOD_KINDS,
  FORENSIC_ENTITIES,
  PARTICIPANT_TYPES,
} from "./types";
