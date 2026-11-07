/** General customer actions remain disabled in private Vercel previews. */
export const customerActionsEnabled = import.meta.env.VITE_ENABLE_CUSTOMER_ACTIONS === 'true'
/** Builds restrict this exception to the registered private beta preview branch.
 * The server separately enforces the approved test recipients and activated sender. */
export const privateBetaEmailEnabled = import.meta.env.VITE_ENABLE_PRIVATE_BETA_EMAIL === 'true'
export const emailDeliveryEnabled = customerActionsEnabled || privateBetaEmailEnabled
