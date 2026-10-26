// DRAFT privacy notice: to be reviewed with the school's data protection officer
// before launch (docs/data-protection.md). Bump PRIVACY_NOTICE_VERSION in
// lib/options.ts whenever this text changes.

export function PrivacyNoticeText() {
  return (
    <div className="notice-text">
      <p>
        <strong>What we collect.</strong> Your answers to the questionnaire: year level, school, course, latest grade
        and grading scale, home province, years of residency, birth date, citizenship, whether you hold another
        scholarship and, if you choose to answer, your household income bracket and 4Ps status.
      </p>
      <p>
        <strong>Sensitive questions are separate.</strong> We ask about disability, Indigenous Peoples membership and
        similar topics only when a listed scholarship needs it, and only after you agree to each one. Students under
        18 also need a parent or guardian's agreement.
      </p>
      <p>
        <strong>How we use it.</strong> Only to show you scholarships whose published requirements match your
        answers, and to notify you about them. Matching runs inside our database. Your answers are not sent to AI
        services, not shown to reviewers or administrators, and not sold or shared.
      </p>
      <p>
        <strong>Your choices.</strong> You can change any answer, withdraw consent for a sensitive question, download
        your data or delete your account at any time from the Privacy page. Withdrawing consent deletes the related
        answers immediately.
      </p>
    </div>
  );
}
