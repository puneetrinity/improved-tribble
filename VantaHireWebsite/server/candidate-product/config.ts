// Dark S1 foundation; no consent/publication/provider flags are implied.
export const foundationEnabled = () => process.env.CANDIDATE_FOUNDATION_ENABLED === 'true';
export const foundationDeliveryEnabled = () => foundationEnabled() && process.env.CANDIDATE_FOUNDATION_DELIVERY_ENABLED === 'true';
// No public copy has policy approval yet. Only disposable tests may capture draft intent.
export const foundationIntentCaptureEnabled = () => foundationEnabled()
  && process.env.NODE_ENV === 'test' && process.env.CANDIDATE_FOUNDATION_DISPOSABLE_TEST === '1';
