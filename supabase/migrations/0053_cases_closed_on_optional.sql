-- Relax cases_closed_on_matches_status: a closed case may have no closing date.
--
-- 0007_cases.sql required closed_on to be present exactly when status is
-- 'closed', so the two representations of "is this finished" could not disagree.
-- That is the right shape for a case opened in this system. It is the wrong
-- shape for thirty years of case history arriving from somewhere else.
--
-- ElectroTek's FileMaker register was measured before this was written:
--
--   Cases marked Closed                                   3,692 of 3,850
--   Cases table fields recording a closing date                        0
--   Original_Data.D_Closed, the 1995-2011 archive           1,919 of 4,082
--   closed Cases able to borrow a date from that archive      447 of 3,692
--
-- So a closing date does exist for part of the history and is simply absent for
-- most of it. Under the old constraint every one of those 3,692 rows fails and
-- the migration writes nothing, which means the choice is between inventing a
-- closing date for 3,245 cases and admitting the firm did not always record one.
--
-- What is kept: a case that is NOT closed still may not carry a closing date,
-- because that combination is a contradiction rather than a gap. What is
-- dropped is the other half, that a closed case must carry one. And
-- cases_closed_not_before_opened is untouched, so a date that is present is
-- still checked for sense.
--
-- Application code must therefore treat closed_on as nullable on a closed case.
-- `status = 'closed'` remains the single source of truth for whether a case is
-- finished; closed_on answers "when", and for most of the imported history the
-- honest answer is that nobody wrote it down.

alter table public.cases
  drop constraint if exists cases_closed_on_matches_status;

alter table public.cases
  add constraint cases_closed_on_requires_closed_status
    check (closed_on is null or status = 'closed');
