# 3D interviewer speech and animation lifecycle — issue #86

The 3D interviewer is an optional presentation layered over the existing
transcript and voice controls. It does not own speech playback or microphone
capture. The route owns both hooks and passes one presentation state to the 3D
component: `speaking` while the current browser utterance is active, otherwise
`listening` while recognition is active, otherwise `idle`. Speaking takes
precedence if both browser APIs briefly report activity.

## State and synchronization contract

| Route/browser event | Presentation and playback |
| --- | --- |
| A question is active with no speech/microphone activity | `idle` |
| Browser speech synthesis emits `onstart` for the active utterance | `speaking`; the procedural mouth/upper-body animation runs |
| Active utterance emits `onend` or `onerror` | Return to `idle`; playback errors keep the transcript available |
| User selects Replay | Cancel current utterance, then track the new utterance's start/end callbacks |
| Main question ID or language changes | Effect cleanup cancels old playback; only callbacks from the new utterance may change state |
| User starts microphone | Route stops interviewer speech before starting recognition; state becomes `listening` after recognition starts |
| User types or edits code while speech plays | Stop speech immediately, then update the answer draft |
| User submits, ends the interview, or navigates away | Cancel speech; unmount cleanup cancels the browser synthesis request |
| Recognition stops/cancels | Recognition state returns to false; presentation falls back to `idle` unless playback is active |

`useSpokenQuestion` associates each utterance with a generation and object
identity. Cancellation invalidates that generation before calling the browser
cancel API, so delayed `onstart`, `onend` or `onerror` callbacks from a previous
question cannot change the current animation or error state. Browser event
ordering remains implementation-dependent, so the transcript and playback
controls remain authoritative.

The mouth animation is a low-cost procedural speaking cue driven by active
speech state; it does not infer phonemes or claim exact lip synchronization.
Listening uses a subtle head movement. Idle and reduced-motion states remain
still. Playback can be muted/stopped independently of the optional 3D display.

## Fallbacks and accessibility

3D starts disabled, is lazy loaded only when requested, and uses the selected
interviewer appearance. Reduced-motion preference disables the animation loop
and preserves the still portrait. WebGL construction errors, render exceptions
and context loss switch to the local still portrait with an explanation. The
route's transcript, text answer, recognition and playback controls continue to
work when rendering fails. No camera stream is connected to the renderer.

The avatar is decorative and hidden from assistive technology. The adjacent
status text describes speaking/listening/idle state. Browser speech errors and
unsupported synthesis leave the visible question transcript and text answer
available. Navigating away disposes renderer geometry/materials and stops its
animation loop, observer and context-loss listener.

## Verification

Hook regression coverage verifies question/language changes, browser start/end,
manual stop and delayed callbacks from canceled utterances. Route tests verify
speaking/listening/idle propagation, microphone handoff, explicit 3D opt-in,
reduced-motion rendering, context/render failure fallback and retained answer
draft/session state. Browser device testing should confirm actual speech event
timing and WebGL presentation because browser synthesis is not sample-accurate.

Related: #61 (3D interviewer) and #78 (voice journey). This follow-up defines
state synchronization and fallback behavior; phoneme-level lip sync is future
work.
