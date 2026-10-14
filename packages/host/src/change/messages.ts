// Plain-language sentences for validation, drift, and save (README 10.5, 13, 22).
export const CHANGE_MESSAGES = {
  blocked: "I couldn't make this change without errors. Your theme hasn't changed.",
  driftConflict:
    'This theme was changed in Shopify while you were working, in the same places your change affects.',
  driftConfirm: 'Shopify changed some of the same files. I merged those edits. Look at the preview, then save again.',
  roleChanged: "This theme's status changed in Shopify while the save was finishing. I stopped further saves.",
  notWritable: "This theme can't be saved to. Only an unpublished theme this app manages can receive a save.",
  checkFailed: "I couldn't check this theme, so I didn't keep the change.",
  nothingToSave: 'There is nothing new to save.',
  connectStore: 'Connect your store before saving.',
  previewSkipped: 'Connect your store to update the preview. Your change is saved on this computer.',
  restored: 'Your previous step is back.',
  discarded: 'Discarded. Your theme was not changed.',
} as const
