# FormFactor

A free, browser-based tool that checks squat and deadlift form using your webcam,
for teen athletes training without a coach or physical therapist.

Built for the Congressional App Challenge.

## What it does

1. Turn on your webcam and stand sideways to it.
2. Click Start set: after a 5-second countdown it records until you click Stop (up to 5 minutes).
3. Click **Analyze** to watch your set back with your joint angles drawn on it. The lines turn
   green, yellow, or red based on your form.
4. Get an overall result, plain-English notes with timestamps (like "Trunk leaned forward quickly
   at 0:03"), a trunk-vs-shin comparison (hip-biased, balanced, or knee-biased), and a button to jump to the worst moment.

Everything runs in the browser. **The camera video never leaves your device.**

FormFactor gives an *angular risk estimate based on published biomechanics research*. It is
**not medical advice** and does not measure force or spinal flexion directly. See
[how-it-works.html](how-it-works.html) for how it works and its limitations.

## Built with

- Plain HTML, CSS, and JavaScript (no framework, no build step, no backend)
- [MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker)
  (`pose_landmarker_full`) from Google, loaded from a CDN

## Files

| File | What it does |
|---|---|
| `index.html` | Landing page |
| `analyze.html` / `analyze.js` | The tool: camera, skeleton, recording, playback, results screen |
| `angle-math.js` | Turns joint positions into angles and angular velocity |
| `form-rules.js` | Thresholds and the safe / warning / danger rules |
| `how-it-works.html` | How it works, sources, limitations |
| `style.css` | Styles |

## Run it on your computer

The camera and MediaPipe only work when the page is served from a web server
(not by double-clicking the file). From inside this folder, run:

```
python -m http.server 8000
```

Then open <http://localhost:8000> in Chrome or Edge. (Python is only used as a local test
server. It is not part of the app.)

## Put it online with GitHub Pages

1. Create a new **public** repository on GitHub named `FormFactor` (don't add a README).
2. In this folder, run:
   ```
   git remote add origin https://github.com/YOUR-USERNAME/FormFactor.git
   git push -u origin main
   ```
3. On GitHub, open the repository → **Settings** → **Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose **main** and **/ (root)**, then **Save**.
5. Wait 1–2 minutes. Your site will be at `https://YOUR-USERNAME.github.io/FormFactor/`.

GitHub Pages uses https, so the camera works there.

## AI Usage Disclosure

_(Edit this section in your own words before submitting.)_

I used **Claude Code** (an AI coding assistant made by Anthropic) while building FormFactor.

- **What I did:** came up with the idea and the problem it solves; did the biomechanics research
  (McGill's spine work, squat biomechanics, safe trunk-angle range of 15°–45°); chose the 45° trunk-lean
  threshold; made the design decisions (live webcam instead of video upload, color-coded playback,
  user-chosen squat depth goal instead of one fixed angle, side-by-side layout); tested the app and
  found bugs; _(add what you tune, rewrite, or change)_.
- **What Claude Code wrote:** the HTML/CSS pages, the camera and MediaPipe code, the skeleton drawing,
  recording and playback, the results screen, and, at my request, the code in `angle-math.js` and `form-rules.js`
  based on my research and design decisions.
- **What I changed afterward:** _(fill in)_
