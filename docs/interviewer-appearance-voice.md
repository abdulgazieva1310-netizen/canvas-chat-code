# Interviewer appearance and voice assets

The `classic`, `sage`, and `rose` appearances are drawn with application-owned CSS
and the existing procedural Three.js avatar. This feature adds no image, model,
font, or animation files. Three.js is distributed under the MIT License; its
license text is included in the installed package at `three/LICENSE`.

Voice choices use the browser's built-in Web Speech synthesis voices. The app
does not download, bundle, redistribute, or cache voice data. Those voices are
provided by the operating system or browser and remain subject to the terms of
that platform and voice provider; users should consult those terms for a chosen
voice. The app stores only the selected voice name and language tag in the
account profile, not audio.

Voice metadata is read from `speechSynthesis.getVoices()` and no extra media is
loaded over the network. If the selected name and language are unavailable on a
device, playback chooses an available voice for the interview language and
announces the fallback. If there is no compatible voice, the transcript remains
available and the existing text interaction continues. The selection does not
affect question generation, evaluation, or scoring.

The 3D renderer remains opt-in, lazy-loaded, and bounded by the existing
error-boundary fallback. Reduced-motion settings continue to be passed to the
renderer, and disabling the avatar leaves speech and text controls available.
