// Dark S1 foundation; no consent/publication/provider flags are implied.
export const foundationEnabled = () => process.env.CANDIDATE_FOUNDATION_ENABLED === 'true';
export const foundationDeliveryEnabled = () => foundationEnabled() && process.env.CANDIDATE_FOUNDATION_DELIVERY_ENABLED === 'true';
export const consentV2DeliveryEnabled = () => foundationEnabled() && process.env.CANDIDATE_CONSENT_V2_DELIVERY_ENABLED === 'true';
// Grants cannot be admitted before the delivery worker is enabled. Withdrawal
// and status remain available with delivery even if new grants are paused.
export const consentV2CaptureEnabled = () => consentV2DeliveryEnabled() && process.env.CANDIDATE_CONSENT_V2_CAPTURE_ENABLED === 'true';
export const profileEnabled = () => foundationEnabled() && process.env.CANDIDATE_PROFILE_ENABLED === 'true';
export const profileDeliveryEnabled = () => profileEnabled() && process.env.CANDIDATE_PROFILE_DELIVERY_ENABLED === 'true';
export const sparkEnabled = () => profileDeliveryEnabled() && consentV2DeliveryEnabled()
  && process.env.CANDIDATE_SPARK_ENABLED === 'true';
// Separate source admission/worker gate; existing Spark saving never enables paid work.
export const resumeSourceEnabled = () => sparkEnabled()
  && process.env.CANDIDATE_RESUME_SOURCE_ENABLED === 'true';
/** The lookup switch as configured, before checking its provider key. */
export const lookupSourceRequested = () => sparkEnabled()
  && process.env.CANDIDATE_LOOKUP_SOURCE_ENABLED === 'true';
/** The candidate lookup key is present and well-formed (its value is never logged). */
export const lookupKeyConfigured = (env: NodeJS.ProcessEnv = process.env) => {
  const key = env.CANDIDATE_RC_API_KEY;
  return !!key && key.length <= 8192 && !/[\s\0]/.test(key);
};
// A missing or malformed key switches off lookup only (routes answer "not available",
// no worker starts); it never stops Flow starting or any other processor.
export const lookupSourceEnabled = () => lookupSourceRequested() && lookupKeyConfigured();
export const interpretationEnabled = () => sparkEnabled()
  && process.env.CANDIDATE_INTERPRETATION_ENABLED === 'true';
export const networkSourcingEnabled = () => sparkEnabled()
  && process.env.CANDIDATE_NETWORK_SOURCING_ENABLED === 'true';
// Explicit default-off public UI switch. Existing Spark flags alone never opt
// users into the replacement signup. Registration still verifies the approved
// consent copy; provider dispatch still requires its durable budget reservation.
export const candidateSparkSignupEnabled = (): boolean =>
  process.env.CANDIDATE_SPARK_SIGNUP_ENABLED === 'true'
  // Requested, not key-checked: a broken lookup key must not silently switch sign-up back to
  // the old page; the wizard continues without the lookup (résumé or typed details).
  && foundationDeliveryEnabled() && consentV2CaptureEnabled() && lookupSourceRequested();
// No public copy has policy approval yet. Only disposable tests may capture draft intent.
export const foundationIntentCaptureEnabled = () => foundationEnabled()
  && process.env.NODE_ENV === 'test' && process.env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST === '1';
