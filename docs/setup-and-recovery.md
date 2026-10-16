# Setup and recovery

Shopify Builder keeps the Anthropic API key and the Theme Access password on this computer. They are encrypted with the operating system's credential store and written to `secrets.json` in the app's user-data folder. The file holds ciphertext only. An update replaces the app, not that folder, so the saved key and password are still there after the new version opens.

## First run

1. Install Docker Desktop and leave it running with Linux containers.
2. Open Shopify Builder. The home screen checks Docker and the three tool images (change assistant, Shopify tools, Claude connection).
3. Connect Claude. Paste an Anthropic API key, choose Save, and wait for "Claude connected" plus the last four characters. The field is cleared immediately. The full key cannot be shown again.
4. Connect your store. Enter the `myshopify.com` domain and the Theme Access password. The app lists your themes through the Shopify tool before it saves the password.
5. Pull an unpublished theme, then start a change. The app starts the Claude connection only while a change is open, and stops it when that change is saved, discarded, or cancelled.

If the key is rejected, the screen says "That key didn't work. Please check it and try again." If Anthropic cannot be reached, it says "Couldn't reach Anthropic. Please check your internet connection."

## If a saved key will not unlock

This can happen when the Windows user profile changes. The home screen asks you to enter the key again. Replace key checks the new key, stores the new ciphertext, and restarts the Claude connection if a change is open. Remove key deletes the ciphertext and stops that connection. Do the same for the store password with Disconnect, then save it again.

## Chats and undo

Chats are kept for 30 days after the last day they were used, then deleted. The home screen warns a few days before that. Saved changes and their Git history stay, so Undo this change still works after the chat is gone. If a later change uses the same files, undo names those later changes and does not push.

## Going live

Get ready to go live checks that every change is saved, Theme Check has no new errors, and the live theme has no edits that this copy is missing. If the live theme changed, bring those edits in, or keep your copy of the overlapping files. The app then shows the steps to follow in Shopify admin and can open the Themes page. It never changes which theme customers see. When you do that yourself, the app notices, retires the working copy, and labels the previous live theme "Previous live version (kept for rollback)". Start a new working copy continues from that theme's history.

## Updates

A signed Windows install is built from `apps/desktop/electron-builder.yml`. The updater accepts a download only when the signature matches, and it will not restart while a change is open. Check for updates on the home screen. If a tool-image download fails, the app keeps the previous verified images. Building that signed installer is a Windows release step; this Mac checkout does not produce it.

## When something is stuck

- Docker is not running: open Docker Desktop, then click Retry.
- A change will not start: connect Claude and the store, then pull the theme. The theme has to be an unpublished theme this app manages before a save can land.
- The Claude connection fails: Remove key, save the key again, and start the change once more.
- Quit the app if a change is wedged. The open session's files stay until you discard them or they expire. The saved theme is unchanged until a save finishes.
