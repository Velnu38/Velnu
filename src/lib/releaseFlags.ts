/** Explicit release gate for any customer-facing email or approval-link action.
 * Never enable for private Vercel previews or an unverified sender domain. */
export const customerActionsEnabled = import.meta.env.VITE_ENABLE_CUSTOMER_ACTIONS === 'true'
