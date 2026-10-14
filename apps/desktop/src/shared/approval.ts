// Copy and keyboard rules for the sensitive-file pop-up (README 10.4).
export const APPROVAL_TITLE = 'Approve changes to important theme files?'
export const APPROVAL_MESSAGE =
  'Claude wants to change files that control settings you may have customized in the Shopify theme editor. Changing them could overwrite those customizations.'
export const APPROVAL_DECLINE_LABEL = 'Decline'
export const APPROVAL_APPROVE_LABEL = 'Approve'
export const APPROVAL_PREVIEW_LABEL = 'Show what will change'

/** Escape and closing the pop-up both count as Decline. */
export function approvalKeyAction(key: string): 'decline' | null {
  if (key === 'Escape') return 'decline'
  return null
}
