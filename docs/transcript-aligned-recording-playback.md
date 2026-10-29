# Transcript-aligned recording playback — issue #89

## Current behavior and data gap

Reports link feedback to saved answer IDs and can jump to the corresponding
transcript exchange. Saved recordings can be played separately from the
transcript. There is no timestamp-to-answer association in the current media
metadata or interview messages, so the UI must not guess an offset from server
message creation times or from recording upload/creation time. Recording may
start partway through an interview, and network, transcription and upload delay
make those times different from the media timeline.

The current report remains the canonical readable review surface. It continues
to show questions, submitted answer text, saved feedback and source links when
there is no recording, no alignment, a playback error, or expired/deleted media.

## Future capture and timestamp contract

To add reliable jumps, a future recorder must explicitly associate transcript
events with the capture clock:

1. Start the clock when the browser confirms the audio recorder is recording,
   using the media timeline (`HTMLMediaElement.currentTime` origin or a monotonic
   capture clock), not wall-clock/server request time.
2. Save a versioned cue for each associated transcript exchange: stable
   `answerId`, recording ID, start offset, optional end offset and clock/schema
   version. Offsets are seconds from the beginning of that exact recording.
3. Capture the cue at the relevant client event while audio capture is active.
   For a submitted answer, associate the beginning/end of the user's spoken
   segment if the browser can provide them. If it cannot, do not manufacture a
   precise answer timestamp. Question playback cues can be stored separately.
4. Validate finite, nonnegative offsets and `start <= end <= media duration`
   when duration is available. A cue must refer to an answer in the same
   interview and a recording owned by that interview. Invalid or unmatched cues
   are ignored and logged without exposing transcript/audio content.
5. Keep cue metadata private and owner-scoped with the recording. Deleting,
   expiring, withdrawing consent or deleting the interview removes/invalidate
   the related cues with the media lifecycle. A media ID is not a public URL.

Do not infer alignment from `Message.createdAt`, `InterviewMediaInfo.createdAt`,
audio duration divided by answer count, or neighboring exchanges. Missing cues
are expected and should remain missing. If upload is delayed, an offset is
relative to the recording bytes and remains stable.

## Review experience

The future report should make alignment a progressive enhancement of existing
transcript and media controls:

- A transcript answer with a valid cue for the currently available recording
  gets a **Play from answer** control adjacent to that answer. Activation opens
  the Saved recordings disclosure if needed, selects the matching recording,
  sets `currentTime` to the start offset and starts playback only after the
  user's explicit action.
- The currently playing transcript answer is highlighted. `timeupdate` advances
  or clears that highlight using cue start/end bounds. Seeking, pausing or
  changing recordings updates/clears the highlight; it must not alter transcript
  text or submitted answer state.
- Several recordings may exist for one interview. Only a cue whose recording ID
  matches a currently listed unexpired media item enables a jump. Do not silently
  jump to a different recording. Explain when no matching recording is available.
- Keyboard focus stays on the initiating control where practical. Player
  controls remain native and accessible; answer links continue to jump to the
  transcript even if media controls fail.

## Missing, expired or deleted media

| Condition | Playback/alignment behavior | Transcript behavior |
| --- | --- | --- |
| No timestamp cue | Do not show a jump control; optionally show a concise “No recording timestamp for this answer” note | Full transcript and report remain available |
| Cue exists but its recording is absent from the list | Disable/remove its jump control; offer refresh where the list failed to load | Keep answer links and text |
| Recording expired, deleted or consent withdrawn | Clear current media source, revoke temporary browser object URLs, clear highlight, refresh media/cue metadata | Keep transcript, feedback and report; say recording is unavailable |
| Download returns 404 after listing | Treat as missing/expired, refresh list, do not expose storage error details | Keep report and permit normal transcript navigation |
| Playback/seek fails or metadata cannot load | Clear player state and show retryable playback error; never fabricate a timestamp | Keep report and transcript usable |
| Offset invalid or beyond actual duration | Ignore the cue and report unavailable alignment; do not seek to zero as though correct | Keep transcript and ordinary Play recording control |
| Browser has no audio/video playback support | Explain playback is unavailable in this browser | Keep transcript and report fully readable |

An unavailable recording must never make report loading fail. Failed API access
or expired media must not delete saved messages, rewrite feedback, or change
interview status. Cached browser blobs should be revoked when media is deleted,
expires, changes, or the page unmounts. Server-side expiry/deletion remains
authoritative because client timers can pause while a tab is suspended.

## Verification plan

Before shipping aligned playback, test valid answer-to-recording jumps, a
recording started mid-interview, multiple recordings, absent and malformed
cues, timestamps at media boundaries, delayed uploads, seek/play failures,
expired/deleted media and consent withdrawal. Verify exact playback offsets
against known synthetic media, playback highlighting and clearing, keyboard
navigation, URL cleanup, owner isolation, report readability and unchanged
transcript text. Exercise a real browser/device because mocked media elements
cannot establish that captured offsets line up with encoded audio timestamps.

Current media retention and deletion rules are in
[recording consent and playback](recording-consent-retention.md). This plan adds
no timestamp fields or runtime behavior until a reviewed capture format and
schema migration are implemented.
