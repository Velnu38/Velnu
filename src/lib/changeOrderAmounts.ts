export type ChangeOrderAmounts = {
  current_total: number
  change_amount: number
  revised_total: number
  deposit_paid: number
  other_paid: number
  revision_subtotal?: number | null
  revision_tax?: number | null
  manual_billing?: boolean
}

/** Linked revisions can represent a signed change even when their billing line is $0. */
export function changeOrderDisplayLine<T extends { quantity: number | string; unit_price: number | string; line_total: number | string }>(
  line: T, index: number, amounts?: ChangeOrderAmounts | null,
) {
  return index === 0 && amounts?.revision_subtotal != null
    ? { ...line, quantity: 1, unit_price: amounts.revision_subtotal, line_total: amounts.revision_subtotal }
    : line
}
