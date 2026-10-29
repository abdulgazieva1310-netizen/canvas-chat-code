# Interviewer appearance — issue #82

The initial choices are Classic (purple), Sage (green) and Rose (rose). These
are color variants of the existing procedural interviewer, with the same face,
animation and voice behavior. They do not require external model/image assets.
The shared catalog is `frontend/src/lib/interviewer-avatar.ts`; both the 3D
clothing color and local still illustration use its swatches.

## Selection and persistence

Choose an appearance in Profile Settings and select **Save changes**. The
authenticated profile API stores `interviewerAvatar` as `classic`, `sage` or
`rose`. The server rejects unknown new values. Omitting this field when editing
other preferences preserves the saved appearance. Existing profiles default
to Classic. Preferences survive logout/login and application restarts.

Each interview reads the signed-in user's saved profile preference, so later
interviews use the same choice. This is a profile preference rather than an
immutable snapshot on historical sessions: reopening a session uses the current
saved choice. Selecting a card without saving does not change interviews.
Appearance does not select a voice, language, question or scoring behavior.

## Availability and fallback

The interviewer starts in the still view. **Enable 3D interviewer** explicitly
loads the existing renderer. The still view shows the selected appearance and
is also the fallback for module/render errors, unsupported WebGL and context
loss. It requires no network image load. A missing or obsolete client-side
appearance resolves to Classic without writing over the saved profile.

Renderer failure displays a message and preserves the answer draft, interview
data, transcript and voice controls. The fallback never resets the saved
choice. Users can retry by toggling the 3D control. Reduced motion keeps the
3D figure still. Leaving 3D returns to the selected local illustration.

## Verification

- Backend profile/API tests cover all three valid IDs, invalid updates, omission
  preservation, reset to Classic, logout/login and restart persistence.
- Profile UI tests cover saving a choice and stable unknown-ID fallback.
- Interview tests cover the saved choice reaching 3D, each appearance surviving
  renderer failure with its draft and cached session intact, reduced motion and
  continued voice/text controls.
- Production build checks the lazy 3D module integration. Browser GPU rendering
  and visual quality still require a manual check on the target device.

Related: #58 (3D interviewer) and #61 (appearance preferences). More models,
custom uploads and independently animated characters are future catalog work.
