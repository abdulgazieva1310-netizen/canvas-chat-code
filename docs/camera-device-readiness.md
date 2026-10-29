# Camera, microphone and device readiness — issue #87

## Current interview behavior

The interview remains usable without a camera or microphone. The transcript
and text answer are always available for an active voice-mode interview, even
when browser recognition is unsupported or denied. Camera preview is optional
and independent from answer input. Recording is a separate explicit action;
camera preview never becomes stored video.

| Action | Permission/request | Status shown | Recovery |
| --- | --- | --- | --- |
| Open an interview | No device permission prompt | Camera off; text/voice controls as selected in setup | Continue in the chosen mode |
| Start microphone input | Browser speech-recognition start, initiated by the microphone button | Listening while recognition is active; user can stop and review the transcript | On denial, missing API or recognition failure, keep transcript editing and Send available |
| Start camera preview | `getUserMedia({audio:false, video:true})`, only after Enable camera | Preparing, Camera on or Camera off | Explain denied permission, missing device, busy/unreadable device or unavailable API; keep text/voice available |
| Stop camera | Stop all preview tracks | Camera off | Can retry from the button after reconnecting or releasing the device elsewhere |
| Device disconnect | Track `ended` event clears preview and stops its tracks | Camera off plus disconnect message | Reconnect then explicitly enable camera again; no hidden retry/prompt |
| Save audio | Separate consent checkbox followed by Start recording | Not recording, Preparing, Recording, Saving or failure | Discard at the size limit; on capture/upload failure preserve transcript and report |
| End interview | Stop camera and microphone; stop recording then await its consented final upload | Ended session/report | Recording failure does not remove transcript/report |

Permission to use camera preview is not microphone permission. Browser speech
recognition controls its own microphone prompt and commonly selects the browser
or operating-system default input. The app does not request a raw microphone
stream just to preflight availability, and does not claim that recognition has
a selected-device API. Raw audio storage requires the separate recording
consent and is disabled until the user explicitly starts it.

## Device-selection policy for video interviews

Before offering a device picker, use `enumerateDevices()` only after the user
has granted the relevant browser permission, since labels and device IDs may
be withheld before permission. Prefer a friendly label plus a stable-in-session
device ID; never persist a raw device ID in the account profile because it can
identify hardware and may not remain valid across browsers. Offer **System
default** and list only inputs the browser exposes. If enumeration is absent,
denied or empty, explain that the browser/OS default will be used and provide
the operating-system device setting as the recovery path.

Changing a camera while previewing must stop the old tracks before requesting
the newly selected `deviceId`. A rejected or over-constrained selection must
leave the old stream stopped, show a useful error, and allow an explicit retry
with System default. Listen for `devicechange` and track `ended`; clear stale
selection and stop all tracks when a device disappears. Never create a
permission prompt automatically in response to a device-change event.

Microphone selection is a separate capability. If the recognition browser API
does not expose a supported device constraint, state that voice input follows
the browser/OS default and point to its device settings. Do not simulate a
microphone picker whose choice is ignored. Selecting or previewing a camera
must not silently change microphone selection, begin recognition, or consent to
recording.

## Permission-denial and interruption rules

- `NotAllowedError`/`SecurityError`: say camera permission was denied; explain
  that browser site settings can restore it. Keep text and voice available.
- `NotFoundError`/`DevicesNotFoundError`: say no camera is available. Keep the
  camera button retryable if the browser API exists.
- `NotReadableError`/`TrackStartError`: explain that the device may be busy,
  disconnected or unavailable; suggest releasing it in another app and retrying.
- `OverconstrainedError`: the selected device/constraints are no longer valid;
  clear that selection and permit an explicit retry with System default.
- Permission prompt pending: show Preparing and allow cancellation. If a stream
  arrives after cancel, ending or navigation, stop its tracks immediately.
- Track ended/device changed: stop and detach preview. Preserve interview,
  transcript and any independent text/recognition path; require explicit retry.
- End, route change or unmount: stop all camera tracks and speech recognition.
  Recording follows its own consented stop/upload policy and must expose its
  current status while that upload finishes.

No device failure should mark an answer submitted, erase a draft, or change the
interview's selected input mode. Camera denial never blocks voice or text.
Microphone denial or unsupported recognition never blocks typing. Recording
permission/codec/upload failure never removes transcript or report data.

## Release and test evidence

Current hook tests cover opt-in permission prompts, default camera constraints,
denial, missing device/API, device disconnect, canceling a pending prompt and
stopping tracks on unmount. Interview tests cover camera status/controls,
recording consent/status, microphone handoff, drafts and report continuity.
These browser mocks verify state transitions, not the wording/timing of native
permission sheets or real hardware labels.

Before a future device picker ships, test default and named camera selection,
permission denied then restored in site settings, busy devices, unplug/replug,
device changes while a prompt is open, unsupported `enumerateDevices`, empty
labels before permission, recognition on default microphone, text fallback,
recording opt-in independent of camera preview, and cleanup on end/navigation.
Record browser/OS/device results and confirm no audio/video track remains live
after stopping. Physical-device checks are needed because browser mocks cannot
simulate driver failures, permission UI, label exposure or real recognition.

Related: #57 and #77. Video interviewing and stored video remain future work;
the existing preview is local camera display, not a recorded video interview.
