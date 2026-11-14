/** General customer actions remain disabled in private Vercel previews. */
export const customerActionsEnabled = import.meta.env.VITE_ENABLE_CUSTOMER_ACTIONS === 'true'
/** Builds restrict this exception to the registered private beta preview branch.
 * The server separately enforces the approved test recipients and activated sender. */
export const privateBetaEmailEnabled = import.meta.env.VITE_ENABLE_PRIVATE_BETA_EMAIL === 'true'
export const emailDeliveryEnabled = customerActionsEnabled || privateBetaEmailEnabled
/** Document-scoped customer actions may be exercised in the registered beta.
 * SMS remains behind the general release flag. Each server action
 * still checks the document token, current revision and Business Pro tier. */
export const customerDocumentActionsEnabled = customerActionsEnabled || privateBetaEmailEnabled

/** Owner-approved Pro appointment invitations use the registered beta email gate.
 * Each offer and confirmation is separately validated by the server. */
export const customerSchedulingEnabled = customerActionsEnabled || privateBetaEmailEnabled
