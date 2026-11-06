// The sign-up consent text as one immutable record: what the candidate saw, word for word.
// Source: ConsentStep.tsx as approved by the user on 30 Oct 2026 (sha256 0fb84fc8…, see
// ealana-index/CANDIDATE_SPARK_CONSENT_WORDING_APPROVAL_20261030.md). Rule: CANDIDATE_SPARK_SHARED_UI_CONTRACT
// consent_copy_rule. The hash is SHA-256 of the canonical JSON (sorted keys, no whitespace) of the
// whole record. ConsentStep.test.tsx proves the popup shows exactly this text and that the hash
// matches. Never edit a published version: any wording, link or policy change is a new version,
// approved again and registered again. Marketing is a separate choice and is not part of this record.
export const CONSENT_COPY_V1 = {
  copyVersion: 1,
  locale: "en",
  title: "Set up your ealana matching profile",
  intro: "Personalised job matching requires joining the ealana talent network. Here's what that means. Agreeing doesn't publish anything: recruiters only see your profile after you confirm it.",
  sections: [
    {
      label: "Building your profile",
      purposes: [
        { id: "profile_enrichment", title: "Fill in your details", text: "We look up your professional profile and read your résumé if you add one. You review the details we propose before they become part of your confirmed profile." },
        { id: "ai_processing", title: "Use AI", text: "AI reads your details, proposes profile details and suggests jobs. It can make mistakes. Nothing it proposes joins your confirmed profile until you accept it." },
        { id: "job_matching", title: "Match you with jobs", text: "We use the profile and preferences you confirm to find jobs that fit you." },
      ],
    },
    {
      label: "Being found by recruiters",
      purposes: [
        { id: "talent_network_discovery", title: "Let recruiters find you", text: "Your confirmed profile joins the ealana talent network, where recruiters can discover it in their searches. Your current employer isn't automatically excluded." },
        { id: "recruiter_contact", title: "Let recruiters contact you", text: "Recruiters who unlock your profile can access your verified email address, your phone number if you add one, and your default résumé if you have one, to contact you about relevant jobs. Companies you apply to receive this information without needing to spend a credit." },
      ],
    },
  ],
  withdrawal: { linkLabel: "Privacy settings", text: "You can withdraw any time in Privacy settings. Withdrawing stops personalised matching and future access to your talent-network profile. It doesn't withdraw applications you've submitted or recall information employers already received." },
  agreement: "I agree to the uses above, the Privacy Policy and the Terms of Service.",
  documents: [
    { label: "Privacy Policy", url: "/privacy-policy", version: "2026-08-26" },
    { label: "Terms of Service", url: "/terms-of-service", version: "2026-08-26" },
  ],
  decline: {
    title: "You can still apply to ealana jobs",
    text: "To continue setting up your profile and receive personalised job matches, you need to join the ealana talent network. If you choose not to, you can still browse ealana jobs and apply as a guest.",
  },
} as const;

/** sha256(canonical JSON of CONSENT_COPY_V1). Checked by ConsentStep.test.tsx. */
export const CONSENT_COPY_V1_HASH = "ee5cd5b23456e6aaa5e5711f0d3b3b18e10d9d274b6b7da73b2afef3a17b2aa8";

/** Version 2 (approved by the user, 2 Nov 2026): only the withdrawal sentence changes; v1 stays as
 * recorded. New sign-ups and setup grants use this version. Codex registers it before activation. */
export const CONSENT_COPY_V2 = {
  ...CONSENT_COPY_V1,
  copyVersion: 2,
  withdrawal: { linkLabel: "Privacy settings", text: "You can withdraw any time in Privacy settings. Withdrawing stops personalised matching and new recruiter access to your talent-network profile. Employers keep details already unlocked on existing job records, without future updates. Your submitted applications remain unchanged." },
} as const;
export const CONSENT_COPY_V2_HASH = "bb133dc6ab8120ad2e866bacec8253eb163415a7d215a80d6fc447c1ea23ac5e";

/** The version the popup shows and grants record. */
export const CONSENT_COPY_CURRENT = CONSENT_COPY_V2;
export const CONSENT_COPY_CURRENT_HASH = CONSENT_COPY_V2_HASH;
