// FormFactor - app.js
// Turns on the webcam, finds the body with MediaPipe, draws a skeleton live,
// saves each frame while a set is recorded, then plays the set back with
// angles (from angles.js) and colors and results (from risk.js).

// MediaPipe pose detection, loaded from a CDN (version pinned so it can't change on us)
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

const COUNTDOWN_SECONDS = 5;
// Recording stops by itself after this long (5 minutes), so the saved pictures can't fill up
// the browser's memory. Each minute is about 1,800 small pictures (roughly 12-25 MB).
const MAX_RECORD_SECONDS = 300;
// Width in pixels of each saved playback picture (smaller = less memory, so longer recordings fit)
const PICTURE_WIDTH = 360;
// When Stop is clicked, this many seconds are cut from the end (that's you walking over to click)
const STOP_TRIM_SECONDS = 2;

// MediaPipe numbers 33 body points. These are the four we analyze on each side.
const LEFT_SIDE = { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
const RIGHT_SIDE = { shoulder: 12, hip: 24, knee: 26, ankle: 28 };

// Pairs of body points to connect for the full-body skeleton (display only)
const FULL_BODY_LINES = [
  [11, 12], [23, 24],                       // shoulders, hips
  [11, 13], [13, 15], [12, 14], [14, 16],   // arms
  [11, 23], [23, 25], [25, 27],             // left side
  [12, 24], [24, 26], [26, 28]              // right side
];

// Line colors for each risk level during playback
const LEVEL_COLORS = {
  safe: "#00c853",     // green
  warning: "#ffd600",  // yellow
  danger: "#ff1744"    // red
};
const NO_LEVEL_COLOR = "#00e5ff";  // blue, used when a frame's level is "unknown"

// Speeds are measured over this many seconds, to smooth out wobbly dots
const SPEED_WINDOW_SECONDS = 0.2;
// Each angle is averaged over this many seconds of frames (centered on the frame)
const SMOOTH_WINDOW_SECONDS = 0.2;
// The live view averages this many frames so its numbers don't flicker
const LIVE_SMOOTH_FRAMES = 5;

// Words shown for the overall result and the muscle pattern
const OVERALL_TEXT = {
  safe: "Good form",
  warning: "Pretty good, a few things to watch",
  danger: "Careful: risky movement spotted"
};
const BACK_TEXT = {
  safe: "Low strain",
  warning: "Some strain",
  danger: "High strain"
};
// Names and plain-English explanations for the trunk-vs-shin categories (Straub & Powers, 2024)
const BIAS_NAME = {
  "hip-biased": "More hips",
  "balanced": "Even",
  "knee-biased": "More knees"
};
const BIAS_TEXT = {
  "hip-biased": "<strong>Your hips did more of the work.</strong> You leaned your chest forward more than your shins, so your glutes and hamstrings worked harder.",
  "balanced": "<strong>Your hips and knees shared the work evenly.</strong> Your chest and shins leaned about the same.",
  "knee-biased": "<strong>Your knees did more of the work.</strong> Your shins leaned forward more than your chest, so your quads (front of thighs) worked harder."
};

// ---- Page elements ----
const startCameraButton = document.getElementById("start-camera-button");
const liftSelect = document.getElementById("lift-type");
const depthChoice = document.getElementById("depth-choice");
const depthSelect = document.getElementById("depth-goal");
const startSetButton = document.getElementById("start-set-button");
const stopSetButton = document.getElementById("stop-set-button");
const analyzeButton = document.getElementById("analyze-button");
const statusText = document.getElementById("status");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const draw = overlay.getContext("2d");
const playback = document.getElementById("playback");
const playbackDraw = playback.getContext("2d");
const countdownText = document.getElementById("countdown");
const recordView = document.getElementById("record-view");
const resultsView = document.getElementById("results-view");
const replayButton = document.getElementById("replay-button");
const worstFrameButton = document.getElementById("worst-frame-button");
const recordAgainButton = document.getElementById("record-again-button");
const playbackStatus = document.getElementById("playback-status");
const resultsBox = document.getElementById("results");

// ---- Things we remember while the page runs ----
let poseLandmarker = null;   // the MediaPipe pose detector
let lastVideoTime = -1;      // so we analyze each camera frame only once
let countdownTimer = null;   // the 1-second countdown timer
let clockTimer = null;       // shows how long we've been recording, every second
let maxTimer = null;         // ends the set at the time limit
let playbackTimer = null;    // the timer that shows the next playback frame
let isRecording = false;     // true while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds
let recordedFrames = [];     // saved data, one entry per frame
let repResults = [];         // one entry per squat rep: when, how deep, trunk-vs-shin, and change from rep 1
let worstIndex = -1;         // frame number of the worst moment (-1 = none)
let setDifference = NaN;     // average trunk-minus-shin angle at the bottom of the squat reps
let liveTrunk = [];          // the last few live trunk angles, for smoothing
let liveShin = [];           // the last few live shin angles, for smoothing
let liveDepth = [];          // the last few live thigh angles (depth), for smoothing

startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopClicked);
analyzeButton.addEventListener("click", openResults);
replayButton.addEventListener("click", replay);
worstFrameButton.addEventListener("click", showWorstFrame);
recordAgainButton.addEventListener("click", backToRecording);
liftSelect.addEventListener("change", showDepthChoice);

// Shows the depth-goal dropdown only when Squat is selected
function showDepthChoice() {
  if (liftSelect.value === "squat") {
    depthChoice.classList.remove("hidden");
  } else {
    depthChoice.classList.add("hidden");
  }
}

// Shows a message under the buttons
function showStatus(message) {
  statusText.textContent = message;
}

// Shows a big number on the video, or hides it when given ""
function showCountdown(text) {
  countdownText.textContent = text;
  if (text === "") {
    countdownText.classList.add("hidden");
  } else {
    countdownText.classList.remove("hidden");
  }
}

// ======== CAMERA + MODEL ========

// Turns on the webcam, loads the pose model, and starts the frame loop
async function startCamera() {
  try {
    showStatus("Turning on camera...");
    video.srcObject = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    await video.play();
  } catch (error) {
    if (error.name === "NotAllowedError") {
      showStatus("Camera permission was blocked. Click the camera icon in the address bar, allow it, and try again.");
    } else {
      showStatus("Couldn't start the camera: " + error.message);
    }
    return;
  }

  // Make both drawing layers the same pixel size as the camera image
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  playback.width = video.videoWidth;
  playback.height = video.videoHeight;
  startCameraButton.disabled = true;

  showStatus("Loading the pose model (can take about 10 seconds)...");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",  // we give it frames one after another
    numPoses: 1            // only look for one person
  });

  startSetButton.disabled = false;
  showStatus("Ready. Stand sideways with your whole body in view, then click Start set.");
  requestAnimationFrame(processFrame);
}

// ======== LIVE FRAME LOOP ========

// Runs on every screen refresh: find the body, draw it, save it if recording
function processFrame() {
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    draw.clearRect(0, 0, overlay.width, overlay.height);

    if (result.landmarks.length > 0) {
      const landmarks = result.landmarks[0];
      const joints = getBestSideJoints(landmarks);
      drawFullBody(landmarks);

      // Live trunk and shin angles (smoothed a little so they don't flicker)
      const trunk = smoothLive(liveTrunk, trunkLeanAngle(joints.shoulder, joints.hip));
      const shin = smoothLive(liveShin, shinAngle(joints.knee, joints.ankle));
      drawFigureStyle(draw, joints, trunk, shin, NO_LEVEL_COLOR);

      // Squats: live depth bar at the top, based on the depth goal
      if (liftSelect.value === "squat") {
        const depth = smoothLive(liveDepth, thighAngle(joints.hip, joints.knee));
        drawDepthBar(draw, depth);
      }
      if (isRecording) {
        saveFrame(joints, now);
      }
    }
  }
  requestAnimationFrame(processFrame);
}

// MediaPipe gives x and y from 0 to 1. This turns them into pixel positions.
// (Needed so angles come out right, since the image is wider than it is tall.)
function toPixels(point) {
  return {
    x: point.x * video.videoWidth,
    y: point.y * video.videoHeight,
    visibility: point.visibility
  };
}

// Adds up how visible (0 to 1 each) one side's four joints are
function sideVisibility(landmarks, side) {
  return landmarks[side.shoulder].visibility + landmarks[side.hip].visibility
       + landmarks[side.knee].visibility + landmarks[side.ankle].visibility;
}

// Picks the side facing the camera and returns its four joints in pixels
function getBestSideJoints(landmarks) {
  let side = LEFT_SIDE;
  let sideName = "left";
  if (sideVisibility(landmarks, RIGHT_SIDE) > sideVisibility(landmarks, LEFT_SIDE)) {
    side = RIGHT_SIDE;
    sideName = "right";
  }
  return {
    side: sideName,
    shoulder: toPixels(landmarks[side.shoulder]),
    hip: toPixels(landmarks[side.hip]),
    knee: toPixels(landmarks[side.knee]),
    ankle: toPixels(landmarks[side.ankle])
  };
}

// Draws one straight line between two points on the given canvas
function drawLine(canvas, start, end, color, width) {
  canvas.strokeStyle = color;
  canvas.lineWidth = width;
  canvas.beginPath();
  canvas.moveTo(start.x, start.y);
  canvas.lineTo(end.x, end.y);
  canvas.stroke();
}

// Draws a thin white skeleton of the whole body (display only)
function drawFullBody(landmarks) {
  for (let i = 0; i < FULL_BODY_LINES.length; i++) {
    const start = toPixels(landmarks[FULL_BODY_LINES[i][0]]);
    const end = toPixels(landmarks[FULL_BODY_LINES[i][1]]);
    drawLine(draw, start, end, "rgba(255,255,255,0.6)", 3);
  }
}

// Draws the analyzed side like the Straub & Powers figure:
//   - the trunk line (hip to shoulder) and shin line (ankle to knee) in `color`
//   - a white straight-up reference line at the hip and at the ankle
//   - each angle's number next to its reference line
//   - "Trunk − Shin = +18°" (and the category, for squats) at the bottom
function drawFigureStyle(canvas, joints, trunk, shin, color) {
  drawLine(canvas, joints.hip, joints.knee, color, 4);        // thigh, thinner
  drawLine(canvas, joints.hip, joints.shoulder, color, 8);    // trunk
  drawLine(canvas, joints.ankle, joints.knee, color, 8);      // shin

  // Straight-up reference lines, as tall as the trunk and shin
  const aboveHip = { x: joints.hip.x, y: joints.shoulder.y };
  const aboveAnkle = { x: joints.ankle.x, y: joints.knee.y };
  drawLine(canvas, joints.hip, aboveHip, "#ffffff", 4);
  drawLine(canvas, joints.ankle, aboveAnkle, "#ffffff", 4);

  // Angle numbers, on the side of the reference line away from the body
  drawAngleNumber(canvas, aboveHip, formatAngle(trunk), joints.shoulder.x > joints.hip.x);
  drawAngleNumber(canvas, aboveAnkle, formatAngle(shin), joints.knee.x > joints.ankle.x);

  // Bottom band: the comparison
  const size = textSize();
  const width = canvas.canvas.width;
  const height = canvas.canvas.height;
  const difference = trunk - shin;
  let category = "";
  if (liftSelect.value === "squat" && !isNaN(difference)) {
    category = BIAS_NAME[movementBias(difference)];
  }

  canvas.fillStyle = "rgba(0, 0, 0, 0.6)";
  canvas.fillRect(0, height - size * 2.8, width, size * 2.8);
  canvas.fillStyle = "#ffffff";
  canvas.font = "bold " + size + "px sans-serif";
  canvas.textAlign = "center";  // the middle stays visible even when the picture is cropped
  canvas.fillText("Trunk − Shin = " + formatSigned(difference), width / 2, height - size * 1.6);
  canvas.fillText(category, width / 2, height - size * 0.4);
  canvas.textAlign = "left";
}

// Draws a bar at the top of the live camera showing current squat depth vs. the depth goal.
// Green with a check mark when the goal is reached.
// depth = thigh angle in degrees (0 = thigh level, positive = hip below knee)
function drawDepthBar(canvas, depth) {
  if (isNaN(depth)) {
    return;
  }
  let goal = THRESHOLDS.parallelThighAngle;
  let goalName = "Parallel";
  if (depthSelect.value === "deep") {
    goal = THRESHOLDS.deepThighAngle;
    goalName = "Deep";
  }

  const size = textSize();
  const width = canvas.canvas.width;
  let text = "Depth " + formatSigned(depth) + "  (goal: " + goalName + ")";
  canvas.fillStyle = "rgba(0, 0, 0, 0.6)";
  if (depth >= goal) {
    text = "✓ " + goalName + " reached (" + formatSigned(depth) + ")";
    canvas.fillStyle = "rgba(0, 160, 70, 0.85)";
  }

  canvas.fillRect(0, 0, width, size * 1.7);
  canvas.fillStyle = "#ffffff";
  canvas.font = "bold " + size + "px sans-serif";
  canvas.textAlign = "center";
  canvas.fillText(text, width / 2, size * 1.2);
  canvas.textAlign = "left";
}

// Writes an angle number beside the top of a reference line.
// If the body part leans to the right, the number goes on the left, and the other way around.
function drawAngleNumber(canvas, point, text, leansRight) {
  const size = textSize();
  canvas.font = "bold " + size + "px sans-serif";
  canvas.lineWidth = 6;
  canvas.strokeStyle = "#000000";
  canvas.fillStyle = "#ffffff";
  let x = point.x + 12;
  if (leansRight) {
    canvas.textAlign = "right";
    x = point.x - 12;
  }
  canvas.strokeText(text, x, point.y + size);
  canvas.fillText(text, x, point.y + size);
  canvas.textAlign = "left";
}

// Adds a new live angle to a short list and returns the average of the list,
// so the live numbers don't flicker
function smoothLive(list, value) {
  list.push(value);
  if (list.length > LIVE_SMOOTH_FRAMES) {
    list.shift();  // remove the oldest value
  }
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total = total + list[i];
  }
  return total / list.length;
}

// Saves one frame: time, side, four joints, and a picture for playback
function saveFrame(joints, now) {
  recordedFrames.push({
    time: (now - recordingStartTime) / 1000,  // seconds since recording started
    side: joints.side,
    shoulder: joints.shoulder,
    hip: joints.hip,
    knee: joints.knee,
    ankle: joints.ankle,
    picture: takePicture()
  });
}

// Makes a small JPEG picture of the camera image (no skeleton) for playback
function takePicture() {
  const small = document.createElement("canvas");
  small.width = PICTURE_WIDTH;
  small.height = Math.round(PICTURE_WIDTH * video.videoHeight / video.videoWidth);
  small.getContext("2d").drawImage(video, 0, 0, small.width, small.height);

  const picture = new Image();
  picture.src = small.toDataURL("image/jpeg", 0.6);  // 0.6 = JPEG quality (smaller file, still clear)
  return picture;
}

// ======== SET TIMING ========

// "Start set" clicked: count down, then start recording
function startSet() {
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
  analyzeButton.disabled = true;

  let secondsLeft = COUNTDOWN_SECONDS;
  showCountdown(String(secondsLeft));
  showStatus("Get into position... recording starts in " + secondsLeft);

  // Every 1000 ms (1 second), count down by one
  countdownTimer = setInterval(function () {
    secondsLeft = secondsLeft - 1;
    showCountdown(String(secondsLeft));
    showStatus("Get into position... recording starts in " + secondsLeft);
    if (secondsLeft === 0) {
      clearInterval(countdownTimer);
      beginRecording();
    }
  }, 1000);
}

// Countdown finished: start saving frames until Stop is clicked (or the time limit)
function beginRecording() {
  showCountdown("");
  recordedFrames = [];
  isRecording = true;
  recordingStartTime = performance.now();
  showStatus("Recording 0:00. Lift now! Click Stop when you're done.");

  // Every second, show how long we've been recording
  clockTimer = setInterval(function () {
    const seconds = (performance.now() - recordingStartTime) / 1000;
    showStatus("Recording " + formatTime(seconds) + ". Click Stop when you're done.");
  }, 1000);

  // Safety limit, so a forgotten recording can't fill up the browser's memory
  maxTimer = setTimeout(stopAtTimeLimit, MAX_RECORD_SECONDS * 1000);
}

// Stop clicked: cut off the last couple of seconds (walking over to click Stop), then end the set
function stopClicked() {
  stopSet(true);
}

// The time limit was reached: end the set without cutting anything off
function stopAtTimeLimit() {
  stopSet(false);
}

// Ends the set and resets the buttons. If cutEnd is true, removes the last STOP_TRIM_SECONDS.
function stopSet(cutEnd) {
  clearInterval(countdownTimer);
  clearInterval(clockTimer);
  clearTimeout(maxTimer);
  showCountdown("");
  startSetButton.disabled = false;
  stopSetButton.disabled = true;

  if (!isRecording) {
    showStatus("Countdown cancelled.");
    return;
  }

  isRecording = false;
  if (cutEnd) {
    removeLastSeconds(STOP_TRIM_SECONDS);
  }
  window.recordedFrames = recordedFrames;  // lets me look at the data in the console

  if (recordedFrames.length === 0) {
    showStatus("Nothing to analyze. Make sure your whole body is in view, and record a bit longer.");
    return;
  }

  analyzeButton.disabled = false;
  const seconds = recordedFrames[recordedFrames.length - 1].time;
  showStatus("Set recorded (" + formatTime(seconds) + "). Click Analyze to see your results.");
}

// Removes the frames from the last `seconds` of the recording
function removeLastSeconds(seconds) {
  if (recordedFrames.length === 0) {
    return;
  }
  const cutoff = recordedFrames[recordedFrames.length - 1].time - seconds;
  while (recordedFrames.length > 0 && recordedFrames[recordedFrames.length - 1].time > cutoff) {
    recordedFrames.pop();  // remove the newest frame
  }
}

// ======== ANALYSIS (uses the functions in angles.js and risk.js) ========

// Works out the angles, the trunk-vs-shin comparison, speeds, and risk level for every frame
function analyzeSet() {
  // 1. Raw angles for every frame
  for (let i = 0; i < recordedFrames.length; i++) {
    const frame = recordedFrames[i];
    frame.rawKnee = kneeAngle(frame.hip, frame.knee, frame.ankle);
    frame.rawHip = calculateAngle(frame.shoulder, frame.hip, frame.knee);
    frame.rawTrunk = trunkLeanAngle(frame.shoulder, frame.hip);
    frame.rawShin = shinAngle(frame.knee, frame.ankle);
  }

  // 2. Smooth each angle by averaging it with nearby frames,
  //    so one wobbly dot can't trigger feedback on its own
  for (let i = 0; i < recordedFrames.length; i++) {
    const frame = recordedFrames[i];
    frame.kneeAngle = averageNearby(i, "rawKnee");
    frame.hipAngle = averageNearby(i, "rawHip");
    frame.trunkLean = averageNearby(i, "rawTrunk");
    frame.shinAngle = averageNearby(i, "rawShin");
  }

  // 3. Compare trunk to shin, measure speeds, and decide the risk level
  for (let i = 0; i < recordedFrames.length; i++) {
    const frame = recordedFrames[i];
    frame.difference = trunkShinDifference(frame);
    frame.bias = movementBias(frame.difference);

    // Speeds compare this frame to one about 0.2 seconds earlier
    const before = recordedFrames[frameBefore(i, SPEED_WINDOW_SECONDS)];
    frame.trunkSpeed = angularVelocity(before.trunkLean, frame.trunkLean, before.time, frame.time);
    frame.kneeSpeed = angularVelocity(before.kneeAngle, frame.kneeAngle, before.time, frame.time);

    frame.level = frameRiskLevel(frame, liftSelect.value);
  }

  // 4. Squats only: at the bottom of each rep, measure depth and trunk vs. shin,
  //    then compare every rep to the first one
  repResults = [];
  setDifference = NaN;
  if (liftSelect.value === "squat") {
    const bottoms = findRepBottoms(recordedFrames);
    for (let i = 0; i < bottoms.length; i++) {
      const bottomFrame = recordedFrames[bottoms[i]];
      repResults.push({
        index: bottoms[i],
        time: bottomFrame.time,
        depth: thighAngle(bottomFrame.hip, bottomFrame.knee),
        difference: bottomFrame.difference,
        bias: bottomFrame.bias
      });
    }
    compareToFirstRep(repResults);
    setDifference = averageBottomDifference(recordedFrames, bottoms);
  }
}

// Returns the average of one saved angle (like "rawTrunk") over frames
// within SMOOTH_WINDOW_SECONDS around frame `index`.
// frames[j][angleName] means "the property called angleName", e.g. frames[j].rawTrunk
function averageNearby(index, angleName) {
  const halfWindow = SMOOTH_WINDOW_SECONDS / 2;
  const centerTime = recordedFrames[index].time;

  // Walk backward, then forward, from this frame until we're more than halfWindow seconds away.
  // (Only looking at nearby frames keeps this fast, even for long recordings.)
  let first = index;
  while (first > 0 && centerTime - recordedFrames[first - 1].time <= halfWindow) {
    first = first - 1;
  }
  let last = index;
  while (last < recordedFrames.length - 1 && recordedFrames[last + 1].time - centerTime <= halfWindow) {
    last = last + 1;
  }

  let total = 0;
  let count = 0;
  for (let j = first; j <= last; j++) {
    if (!isNaN(recordedFrames[j][angleName])) {
      total = total + recordedFrames[j][angleName];
      count = count + 1;
    }
  }
  if (count === 0) {
    return NaN;
  }
  return total / count;
}

// Returns the number of the frame about `seconds` before frame `index` (or frame 0)
function frameBefore(index, seconds) {
  let earlier = index;
  while (earlier > 0 && recordedFrames[index].time - recordedFrames[earlier].time < seconds) {
    earlier = earlier - 1;
  }
  return earlier;
}

// ======== PLAYBACK ========

// "Analyze" clicked: analyze the set, switch to the results screen, and play it back
function openResults() {
  analyzeSet();
  recordView.classList.add("hidden");
  resultsView.classList.remove("hidden");  // showing it again also replays the slide-in
  window.scrollTo(0, 0);
  showResults();
  replay();
}

// "Record another set" clicked: stop playback and go back to the recording screen
function backToRecording() {
  clearTimeout(playbackTimer);
  resultsView.classList.add("hidden");
  recordView.classList.remove("hidden");
  window.scrollTo(0, 0);
  showStatus("Ready. Click Start set to record another set.");
}

// Plays the recorded set from the beginning
function replay() {
  clearTimeout(playbackTimer);
  playFrame(0);
}

// Shows a message under the playback
function showPlaybackStatus(message) {
  playbackStatus.textContent = message;
}

// Shows one frame, then waits the real time gap before showing the next one
function playFrame(index) {
  const frame = recordedFrames[index];
  drawPlaybackFrame(frame);
  showPlaybackStatus("Playback: " + formatTime(frame.time));

  if (index + 1 < recordedFrames.length) {
    const waitMs = (recordedFrames[index + 1].time - frame.time) * 1000;
    playbackTimer = setTimeout(function () {
      playFrame(index + 1);
    }, waitMs);
  } else {
    showPlaybackStatus("Playback finished.");
  }
}

// Draws one saved frame: the picture, colored lines, and angle labels
function drawPlaybackFrame(frame) {
  playbackDraw.drawImage(frame.picture, 0, 0, playback.width, playback.height);
  drawFigureStyle(playbackDraw, frame, frame.trunkLean, frame.shinAngle, colorForLevel(frame.level));
  drawLabel(playbackDraw, frame.hip, "Hip " + formatAngle(frame.hipAngle));
  drawLabel(playbackDraw, frame.knee, "Knee " + formatAngle(frame.kneeAngle));
}

// Picks a text size that fits the camera's resolution (bigger picture = bigger text)
function textSize() {
  return Math.round(video.videoHeight / 22);
}

// Turns a difference into text with a sign, like "+12°" or "-5°"
function formatSigned(angle) {
  if (typeof angle !== "number" || isNaN(angle)) {
    return "--";
  }
  if (angle > 0) {
    return "+" + Math.round(angle) + "°";
  }
  return Math.round(angle) + "°";
}

// Picks the line color for "safe", "warning", or "danger" (blue if no level yet)
function colorForLevel(level) {
  if (level === "safe" || level === "warning" || level === "danger") {
    return LEVEL_COLORS[level];
  }
  return NO_LEVEL_COLOR;
}

// Turns an angle into text like "92°" (or "--" if my function hasn't returned a number yet)
function formatAngle(angle) {
  if (typeof angle !== "number" || isNaN(angle)) {
    return "--";
  }
  return Math.round(angle) + "°";
}

// Writes white text with a black outline just to the right of a joint
function drawLabel(canvas, point, text) {
  canvas.font = "bold " + textSize() + "px sans-serif";
  canvas.lineWidth = 6;
  canvas.strokeStyle = "#000000";
  canvas.fillStyle = "#ffffff";
  canvas.strokeText(text, point.x + 18, point.y);
  canvas.fillText(text, point.x + 18, point.y);
}

// ======== RESULTS ========

// Fills the Results box: overall result, flags, trunk vs. shin, lower back, and rep-by-rep table
function showResults() {
  const lift = liftSelect.value;
  const overall = overallLevel(recordedFrames, repResults);
  const flags = buildFlags(recordedFrames, lift, repResults);
  worstIndex = worstFrameIndex(recordedFrames);

  let html = "<div class='overall " + overall + "'>" + OVERALL_TEXT[overall] + "</div>";

  // Plain-English flags
  html = html + "<ul class='flags'>";
  for (let i = 0; i < flags.length; i++) {
    html = html + "<li>" + flags[i] + "</li>";
  }
  html = html + "</ul>";

  // The "Show worst moment" button under the playback only works if there is a worst moment
  if (worstIndex === -1) {
    worstFrameButton.disabled = true;
    worstFrameButton.textContent = "No worst moment";
  } else {
    worstFrameButton.disabled = false;
    worstFrameButton.textContent = "Show worst moment (" + formatTime(recordedFrames[worstIndex].time) + ")";
  }

  // Which muscles worked more (trunk vs. shin)
  html = html + "<h3>Which muscles worked more?</h3>" + biasHtml(lift);

  // Lower back
  const back = lowerBackLoad(recordedFrames);
  html = html + "<h3>Lower back</h3>" +
    "<p><span class='dot " + back + "'></span> <strong>" + BACK_TEXT[back] + "</strong>" +
    " <span class='muted'>(from how fast your chest moved)</span></p>";

  if (lift === "squat") {
    html = html + "<h3>Rep by rep</h3>" + repTableHtml();
  }

  html = html +
    "<p class='muted'><span class='dot safe'></span> good &nbsp; <span class='dot warning'></span> watch this &nbsp; " +
    "<span class='dot danger'></span> careful. An estimate from your body angles, based on published research.</p>";

  resultsBox.innerHTML = html;

  // The chart only exists after the HTML above is added, so draw it now
  if (lift === "squat" && !isNaN(setDifference)) {
    drawBiasChart();
  }
}

// Makes the trunk-vs-shin panel: the category, what it means, and a chart
function biasHtml(lift) {
  if (lift !== "squat") {
    return "<p class='muted'>Only shown for squats.</p>";
  }
  if (isNaN(setDifference)) {
    return "<p class='muted'>No squat reps found.</p>";
  }

  const bias = movementBias(setDifference);
  return "<p>" + BIAS_TEXT[bias] + "</p>" +
    "<canvas id='bias-chart' class='chart' width='600' height='220'></canvas>" +
    "<p class='muted'>How it changed during your set. Dots = bottom of each rep. " +
    "Gray = even. (Chest lean minus shin lean: " + formatSigned(setDifference) + " on average. " +
    "Based on Straub &amp; Powers, 2024. This is not a sign of injury.)</p>";
}

// Draws a line chart of trunk-minus-shin over time, with the balanced zone shaded
function drawBiasChart() {
  const chart = document.getElementById("bias-chart");
  const pen = chart.getContext("2d");
  const lastTime = recordedFrames[recordedFrames.length - 1].time;
  const maxDegrees = 40;  // the chart shows -40° (bottom) to +40° (top)
  if (lastTime === 0) {
    return;
  }

  // Turns a time into a left-right position, and a difference into an up-down position
  function xFor(time) {
    return 50 + (time / lastTime) * (chart.width - 60);
  }
  function yFor(difference) {
    let limited = difference;
    if (limited > maxDegrees) {
      limited = maxDegrees;
    }
    if (limited < -maxDegrees) {
      limited = -maxDegrees;
    }
    return chart.height / 2 - (limited / maxDegrees) * (chart.height / 2 - 10);
  }

  // Background and the shaded balanced zone
  pen.fillStyle = "#ffffff";
  pen.fillRect(0, 0, chart.width, chart.height);
  pen.fillStyle = "#e8eaee";
  pen.fillRect(50, yFor(THRESHOLDS.biasMargin), chart.width - 60,
    yFor(-THRESHOLDS.biasMargin) - yFor(THRESHOLDS.biasMargin));

  // Labels for the three zones
  pen.fillStyle = "#5b6475";
  pen.font = "12px sans-serif";
  pen.fillText("More hips", 54, 20);
  pen.fillText("Even", 54, chart.height / 2 + 4);
  pen.fillText("More knees", 54, chart.height - 10);
  pen.fillText("+" + maxDegrees + "°", 4, 14);
  pen.fillText("0°", 4, chart.height / 2 + 4);
  pen.fillText("-" + maxDegrees + "°", 4, chart.height - 4);

  // The line: trunk minus shin for every frame
  pen.strokeStyle = "#2364d2";
  pen.lineWidth = 2;
  pen.beginPath();
  let started = false;
  for (let i = 0; i < recordedFrames.length; i++) {
    const frame = recordedFrames[i];
    if (isNaN(frame.difference)) {
      started = false;  // skip frames with no angle, and start the line again after them
      continue;
    }
    if (!started) {
      pen.moveTo(xFor(frame.time), yFor(frame.difference));
      started = true;
    } else {
      pen.lineTo(xFor(frame.time), yFor(frame.difference));
    }
  }
  pen.stroke();

  // A dot at the bottom of each rep
  pen.fillStyle = "#1d2330";
  for (let i = 0; i < repResults.length; i++) {
    pen.beginPath();
    pen.arc(xFor(repResults[i].time), yFor(repResults[i].difference), 5, 0, 2 * Math.PI);
    pen.fill();
  }
}

// Stops playback and shows the single worst frame
function showWorstFrame() {
  if (worstIndex === -1 || worstIndex >= recordedFrames.length) {
    return;  // nothing to show
  }
  clearTimeout(playbackTimer);
  drawPlaybackFrame(recordedFrames[worstIndex]);
  showPlaybackStatus("Showing the worst moment, at " + formatTime(recordedFrames[worstIndex].time) +
    ". Click Replay to play the whole set again.");
}

// Makes a table with one row per rep: depth and trunk-vs-shin, and how each changed from rep 1
function repTableHtml() {
  if (repResults.length === 0) {
    return "<p class='muted'>No reps found. Make sure your knees bend well past standing during each rep.</p>";
  }

  let html = "<div class='table-wrap'><table class='rep-table'>" +
    "<tr><th>Rep</th><th>How deep</th><th>vs. 1st rep</th><th>Muscles</th></tr>";

  for (let i = 0; i < repResults.length; i++) {
    const rep = repResults[i];

    // Depth compared to the first rep, in words
    let depthChangeText = "—";
    if (i > 0) {
      depthChangeText = depthChangeWords(rep.depthChange);
      if (isLessDeep(rep)) {
        depthChangeText = "<span class='dot warning'></span> " + depthChangeText;
      }
    }

    // Which muscles worked more, with a yellow dot if it changed a lot from the first rep
    let musclesText = BIAS_NAME[rep.bias] || "--";
    if (i > 0 && isPatternShift(rep)) {
      musclesText = "<span class='dot warning'></span> " + musclesText;
    }

    html = html + "<tr>" +
      "<td>" + (i + 1) + "</td>" +
      "<td>" + formatSigned(rep.depth) + "</td>" +
      "<td>" + depthChangeText + "</td>" +
      "<td>" + musclesText + "</td>" +
      "</tr>";
  }

  html = html + "</table></div>" +
    "<p class='muted'>How deep: 0° = thighs level with the floor, + = deeper, − = higher. " +
    "Each rep is compared to your first one. Yellow dot = big change.</p>";
  return html;
}

// Turns a depth change into words, like "5° shallower", "3° deeper", or "same"
function depthChangeWords(change) {
  if (isNaN(change)) {
    return "--";
  }
  if (Math.abs(change) < 2) {
    return "same";
  }
  if (change < 0) {
    return Math.round(-change) + "° shallower";
  }
  return Math.round(change) + "° deeper";
}
