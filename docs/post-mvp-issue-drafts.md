# Post-MVP issue drafts

These drafts extend the existing post-MVP backlog (#63–#75). They are ready to publish when GitHub access is restored. Issue numbers and labels will be assigned by GitHub.

## Add focused AI-generated study plans

**Goal:** Turn a user's interview history into a practical, adjustable preparation plan.

**Description:** Let a user generate a short study plan from selected completed interview reports and weak areas. Each plan should contain specific topics, practice activities, and a suggested order. Users can mark items complete, regenerate a plan, or remove it. Keep plans grounded in report evidence and distinguish suggestions from objective assessments. Do not generate a plan when there is not enough scored history; explain what additional practice is needed.

**Acceptance criteria:**

- Users can create a plan from their own selected reports, with a clear comparison group and source references.
- Plan items include a topic, rationale tied to source feedback, and a concrete practice action.
- Users can mark items complete and see that status after reload.
- Users can regenerate or delete a plan without changing source reports.
- Empty, insufficient-history, provider-failure, and malformed-output states are handled without fabricating recommendations.
- Cross-account access to plans and source reports is denied.
- The UI labels the plan as coaching guidance and offers a path to start a relevant practice interview.

## Add browser-based video interview practice

**Goal:** Let users practice presenting themselves on camera during an interview.

**Description:** Add an opt-in video mode for supported browsers, with camera and microphone permission handling, a local preview, and clear controls to start and stop. The initial release should process video locally for the live session and must not upload or persist raw recordings. Continue to show the transcript and existing interview controls. Do not infer confidence, emotion, or hiring readiness from appearance.

**Acceptance criteria:**

- Users explicitly enable video and see a camera preview before starting.
- Permission denial, missing devices, unsupported browsers, and device loss have understandable recovery paths.
- Users can mute, disable camera, and stop the session at any time.
- Raw video is not sent to the backend or stored; network behavior is verified with a test or documented capture.
- Existing text and voice modes remain available as fallbacks.
- The interface explains what is processed and retained before camera activation.
- Accessibility checks cover keyboard operation and visible camera/microphone state.

## Add an animated interviewer avatar

**Goal:** Make spoken practice feel more conversational with an on-screen interviewer.

**Description:** Add an optional animated interviewer for voice sessions, initially using a single lightweight avatar and a small set of approved expressions. Synchronize simple mouth movement with generated speech where browser support permits. Keep the transcript and text interaction fully usable, and avoid implying that the avatar observes or evaluates the candidate.

**Acceptance criteria:**

- Users can enable or disable the avatar without changing interview content or scores.
- The avatar shows clear speaking, listening, and idle states and stops animation when speech ends or is cancelled.
- Reduced-motion preferences are honored, with a static fallback.
- Speech or rendering failures fall back to the existing voice/text experience.
- No camera access is requested for the avatar feature.
- The experience is checked on supported desktop and mobile browsers for performance and accessible controls.

## Add selectable interviewer appearance and voice

**Goal:** Let users choose an interviewer presentation that suits their practice preference.

**Description:** After the single-avatar experience is stable, offer a small curated set of interviewer appearance and voice options. Save the preference to the user's profile and apply it consistently to new sessions. Options must not change question selection, difficulty, feedback, or scores.

**Acceptance criteria:**

- Users can preview and select from the available options in settings.
- The selected option persists across sessions and can be reset to the default.
- Unsupported voices or assets fall back cleanly and explain the fallback.
- Selection does not change interview content or evaluation behavior.
- Asset and voice licenses are documented, and loading remains bounded on mobile connections.
- The feature works with avatar disabled and respects reduced-motion and text-only preferences.

## Add sandboxed coding interview execution

**Goal:** Allow candidates to run their code against controlled examples during coding practice.

**Description:** Extend the existing coding runner with question-specific test execution in an isolated environment. The runner must enforce resource, time, output, and network limits; treat submitted code as untrusted; and return bounded results to the authenticated interview owner. Keep execution disabled for languages or questions without reviewed test specifications. This is a follow-on to the current raw execution gateway and expanded judge coverage (#68).

**Acceptance criteria:**

- Only reviewed question specifications can invoke automated judging; missing specifications use static review only.
- Each supported problem has public examples and hidden edge cases with documented reference behavior.
- Execution has hard CPU, memory, wall-time, output, and concurrency limits and no outbound network access.
- Compilers and runtimes run in an isolated, non-privileged environment with cleanup after every run.
- Results distinguish pass, fail, timeout, resource limit, compile error, and infrastructure error.
- Submissions and outputs are not retained beyond the documented session policy.
- Adversarial tests cover filesystem access, process spawning, resource exhaustion, and cross-user result access.
- The UI clearly labels code execution and preserves static AI feedback when judging is unavailable.
