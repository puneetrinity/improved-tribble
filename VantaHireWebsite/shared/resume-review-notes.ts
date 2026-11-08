/** Added by the server when the model returned résumé facts but none could be checked against
 * the résumé text. The review screen keys on this exact text, so it says "we couldn't match"
 * instead of "nothing new". Shared so the two sides can never drift. */
export const RESUME_UNMATCHED_NOTE = 'We found details in your résumé but couldn’t match them reliably to its text, so nothing was added. You can add them yourself.';
/** Added when the model's output could not be read at all (invalid JSON or every fact malformed). */
export const RESUME_UNREADABLE_NOTE = 'We could not read suggestions from this résumé. Please fill in your profile yourself.';
