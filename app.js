// FormFactor - app.js
// Turns on the webcam, finds the body with MediaPipe, draws a skeleton live,
// saves each frame while a set is recorded, then plays the set back with
// angles (from angles.js) and colors and results (from risk.js).

// MediaPipe pose detection, loaded from a CDN (version pinned so it can't change on us)
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

const COUNTDOWN_SECONDS = 5;

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

// Words shown for the overall result and the muscle pattern
const OVERALL_TEXT = {
  safe: "Green: good form in this set",
  warning: "Yellow: some things to work on",
  danger: "Red: risky movement found"
};
// Names and plain-English explanations for the trunk-vs-shin categories (Straub & Powers, 2024)
const BIAS_NAME = {
  "hip-biased": "Hip-biased",
  "balanced": "Approximately balanced",
  "knee-biased": "Knee-biased"
};
const BIAS_TEXT = {
  "hip-biased": "Your trunk leaned more than your shin. This is associated with relatively greater demand on the hip extensors (glutes and hamstrings).",
  "balanced": "Your trunk and shin leaned about the same amount. The demands on your hip and knee extensors are more similar.",
  "knee-biased": "Your shin leaned more than your trunk. This is associated with relatively greater demand on the knee extensors (quadriceps)."
};

// ---- Page elements ----
const startCameraButton = document.getElementById("start-camera-button");
const liftSelect = document.getElementById("lift-type");
const depthChoice = document.getElementById("depth-choice");
const depthSelect = document.getElementById("depth-goal");
const setLengthSelect = document.getElementById("set-length");
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
const resultsCard = document.getElementById("results-card");
const resultsBox = document.getElementById("results");

// ---- Things we remember while the page runs ----
let poseLandmarker = null;   // the MediaPipe pose detector
let lastVideoTime = -1;      // so we analyze each camera frame only once
let countdownTimer = null;   // the 1-second countdown timer
let stopTimer = null;        // the timer that ends the set
let playbackTimer = null;    // the timer that shows the next playback frame
let isRecording = false;     // true while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds
let recordedFrames = [];     // saved data, one entry per frame
let repResults = [];         // one entry per squat rep: when it happened and if it reached depth
let worstIndex = -1;         // frame number of the worst moment (-1 = none)
let setDifference = NaN;     // average trunk-minus-shin angle at the bottom of the squat reps

startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopSet);
analyzeButton.addEventListener("click", startPlayback);
liftSelect.addEventListener("change", showDepthChoice);

// Shows the depth dropdown only when Squat is selected
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
      drawSide(draw, joints, NO_LEVEL_COLOR);
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

// Draws the analyzed side in one color: shoulder - hip - knee - ankle
function drawSide(canvas, joints, color) {
  drawLine(canvas, joints.shoulder, joints.hip, color, 8);
  drawLine(canvas, joints.hip, joints.knee, color, 8);
  drawLine(canvas, joints.knee, joints.ankle, color, 8);
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
  small.width = 480;
  small.height = Math.round(480 * video.videoHeight / video.videoWidth);
  small.getContext("2d").drawImage(video, 0, 0, small.width, small.height);

  const picture = new Image();
  picture.src = small.toDataURL("image/jpeg", 0.7);
  return picture;
}

// ======== SET TIMING ========

// "Start set" clicked: count down, then start recording
function startSet() {
  stopPlayback();
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
  analyzeButton.disabled = true;
  resultsCard.classList.add("hidden");

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

// Countdown finished: start saving frames, and stop after the chosen time
function beginRecording() {
  showCountdown("");
  recordedFrames = [];
  isRecording = true;
  recordingStartTime = performance.now();

  const setSeconds = Number(setLengthSelect.value);
  showStatus("Recording " + setSeconds + " seconds. Lift now!");
  stopTimer = setTimeout(stopSet, setSeconds * 1000);
}

// Ends the set (time's up, or Stop clicked) and resets the buttons
function stopSet() {
  clearInterval(countdownTimer);
  clearTimeout(stopTimer);
  showCountdown("");
  startSetButton.disabled = false;
  stopSetButton.disabled = true;

  if (!isRecording) {
    showStatus("Countdown cancelled.");
    return;
  }

  isRecording = false;
  window.recordedFrames = recordedFrames;  // lets me look at the data in the console

  if (recordedFrames.length === 0) {
    showStatus("No body was found. Step back so your whole body is in view and try again.");
    return;
  }

  analyzeButton.disabled = false;
  showStatus("Set recorded (" + recordedFrames.length + " frames). Click Analyze to watch it back.");
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

  // 4. Squats only: find each rep's bottom, check depth, and compare trunk vs. shin there
  repResults = [];
  setDifference = NaN;
  if (liftSelect.value === "squat") {
    const bottoms = findRepBottoms(recordedFrames);
    for (let i = 0; i < bottoms.length; i++) {
      const bottomFrame = recordedFrames[bottoms[i]];
      repResults.push({
        index: bottoms[i],
        time: bottomFrame.time,
        reached: reachedDepth(bottomFrame, depthSelect.value),
        difference: bottomFrame.difference,
        bias: bottomFrame.bias
      });
    }
    setDifference = averageBottomDifference(recordedFrames, bottoms);
  }
}

// Returns the average of one saved angle (like "rawTrunk") over frames
// within SMOOTH_WINDOW_SECONDS around frame `index`.
// frames[j][angleName] means "the property called angleName", e.g. frames[j].rawTrunk
function averageNearby(index, angleName) {
  let total = 0;
  let count = 0;
  for (let j = 0; j < recordedFrames.length; j++) {
    const gap = Math.abs(recordedFrames[j].time - recordedFrames[index].time);
    if (gap <= SMOOTH_WINDOW_SECONDS / 2 && !isNaN(recordedFrames[j][angleName])) {
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

// "Analyze" clicked: analyze the set, then play it back from the start
function startPlayback() {
  stopPlayback();
  analyzeSet();
  playback.classList.remove("hidden");
  showResults();
  playFrame(0);
}

// Shows one frame, then waits the real time gap before showing the next one
function playFrame(index) {
  const frame = recordedFrames[index];
  drawPlaybackFrame(frame);
  showStatus("Playback: " + frame.time.toFixed(1) + " seconds");

  if (index + 1 < recordedFrames.length) {
    const waitMs = (recordedFrames[index + 1].time - frame.time) * 1000;
    playbackTimer = setTimeout(function () {
      playFrame(index + 1);
    }, waitMs);
  } else {
    showStatus("Playback finished. Click Analyze to watch again, or Start set to record a new set.");
  }
}

// Stops playback and goes back to the live camera
function stopPlayback() {
  clearTimeout(playbackTimer);
  playback.classList.add("hidden");
}

// Draws one saved frame: the picture, colored lines, and angle labels
function drawPlaybackFrame(frame) {
  playbackDraw.drawImage(frame.picture, 0, 0, playback.width, playback.height);
  drawSide(playbackDraw, frame, colorForLevel(frame.level));
  drawLabel(frame.shoulder, "Trunk " + formatAngle(frame.trunkLean));
  drawLabel(frame.hip, "Hip " + formatAngle(frame.hipAngle));
  drawLabel(frame.knee, "Knee " + formatAngle(frame.kneeAngle));
  drawLabel(frame.ankle, "Shin " + formatAngle(frame.shinAngle));
  if (liftSelect.value === "squat") {
    drawComparisonBox(frame);
  }
}

// Writes the trunk-vs-shin comparison at the top of the picture, like:
//   Trunk 40° − Shin 28° = +12°
//   Hip-biased
function drawComparisonBox(frame) {
  const size = textSize();
  const middle = playback.width / 2;  // the middle stays visible even when the picture is cropped
  const line1 = "Trunk " + formatAngle(frame.trunkLean) + " − Shin " + formatAngle(frame.shinAngle) +
    " = " + formatSigned(frame.difference);
  const line2 = BIAS_NAME[frame.bias] || "";

  playbackDraw.font = "bold " + size + "px sans-serif";
  playbackDraw.textAlign = "center";
  playbackDraw.fillStyle = "rgba(0, 0, 0, 0.6)";
  playbackDraw.fillRect(0, 0, playback.width, size * 2.8);
  playbackDraw.fillStyle = "#ffffff";
  playbackDraw.fillText(line1, middle, size * 1.2);
  playbackDraw.fillText(line2, middle, size * 2.4);
  playbackDraw.textAlign = "left";  // put it back for the joint labels
}

// Picks a text size that fits the camera's resolution (bigger picture = bigger text)
function textSize() {
  return Math.round(playback.height / 22);
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
function drawLabel(point, text) {
  playbackDraw.font = "bold " + textSize() + "px sans-serif";
  playbackDraw.lineWidth = 6;
  playbackDraw.strokeStyle = "#000000";
  playbackDraw.fillStyle = "#ffffff";
  playbackDraw.strokeText(text, point.x + 18, point.y);
  playbackDraw.fillText(text, point.x + 18, point.y);
}

// ======== RESULTS ========

// Fills the Results box: overall result, flags, muscle emphasis, depth, and worst frame
function showResults() {
  resultsCard.classList.remove("hidden");

  const lift = liftSelect.value;
  const overall = overallLevel(recordedFrames, repResults);
  const flags = buildFlags(recordedFrames, lift, depthSelect.value, repResults);
  worstIndex = worstFrameIndex(recordedFrames);

  let html = "<div class='overall " + overall + "'>" + OVERALL_TEXT[overall] + "</div>";

  // Plain-English flags
  html = html + "<ul class='flags'>";
  for (let i = 0; i < flags.length; i++) {
    html = html + "<li>" + flags[i] + "</li>";
  }
  html = html + "</ul>";

  // Button to jump to the worst frame
  if (worstIndex !== -1) {
    html = html + "<p><button class='button' id='worst-frame-button'>Show worst moment (" +
      formatTime(recordedFrames[worstIndex].time) + ")</button></p>";
  }

  // Trunk vs. shin comparison (the muscle-emphasis panel)
  html = html + "<h3>Trunk vs. shin</h3>" + biasHtml(lift);

  // Lower-back load
  html = html + "<h3>Lower-back load</h3>" +
    "<p><span class='dot " + lowerBackLoad(recordedFrames) + "'></span> <strong>" +
    lowerBackLoad(recordedFrames) + "</strong> (based on how fast your trunk angle changed)</p>";

  if (lift === "squat") {
    html = html + "<h3>Depth check</h3>" + depthListHtml();
  }

  html = html +
    "<p class='muted'><span class='dot safe'></span> safe &nbsp; <span class='dot warning'></span> warning &nbsp; " +
    "<span class='dot danger'></span> danger. This is an angular risk estimate based on published " +
    "biomechanics research, not a medical or force measurement.</p>";

  resultsBox.innerHTML = html;

  // The button and chart only exist after the HTML above is added, so connect them now
  if (worstIndex !== -1) {
    document.getElementById("worst-frame-button").addEventListener("click", showWorstFrame);
  }
  if (lift === "squat" && !isNaN(setDifference)) {
    drawBiasChart();
  }
}

// Makes the trunk-vs-shin panel: the category, what it means, and a chart
function biasHtml(lift) {
  if (lift !== "squat") {
    return "<p class='muted'>The trunk-vs-shin categories come from squat research, so they are only shown for squats.</p>";
  }
  if (isNaN(setDifference)) {
    return "<p class='muted'>No squat reps found, so there is nothing to compare yet.</p>";
  }

  const bias = movementBias(setDifference);
  return "<p><strong>" + BIAS_NAME[bias] + "</strong>: at the bottom of your reps, trunk minus shin was " +
    "<strong>" + formatSigned(setDifference) + "</strong> on average.</p>" +
    "<p>" + BIAS_TEXT[bias] + "</p>" +
    "<canvas id='bias-chart' class='chart' width='600' height='220'></canvas>" +
    "<p class='muted'>The chart shows trunk minus shin over the whole set: down into each rep, " +
    "the bottom (dots), and back up. The gray band is the balanced zone (within " +
    THRESHOLDS.biasMargin + "°). Categories from Straub &amp; Powers (2024), A Biomechanical Review of " +
    "the Squat Exercise. This describes how the work is shared between hips and knees. It is not an " +
    "injury risk or a form failure.</p>";
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
  pen.fillText("Hip-biased", 54, 20);
  pen.fillText("Balanced", 54, chart.height / 2 + 4);
  pen.fillText("Knee-biased", 54, chart.height - 10);
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
  clearTimeout(playbackTimer);
  playback.classList.remove("hidden");
  drawPlaybackFrame(recordedFrames[worstIndex]);
  showStatus("Showing the worst moment, at " + formatTime(recordedFrames[worstIndex].time) +
    ". Click Analyze to play the whole set again.");
}

// Makes the list of reps, like "Rep 1 at 0:02: reached your depth goal"
function depthListHtml() {
  if (repResults.length === 0) {
    return "<p class='muted'>No reps found. Make sure your knees bend well past standing during each rep.</p>";
  }

  let html = "<ul>";
  for (let i = 0; i < repResults.length; i++) {
    const rep = repResults[i];
    let message = "--";
    if (rep.reached === true) {
      message = "<span class='dot safe'></span> reached your depth goal";
    } else if (rep.reached === false) {
      message = "<span class='dot warning'></span> didn't reach your depth goal";
    }
    html = html + "<li>Rep " + (i + 1) + " at " + formatTime(rep.time) + ": " + message +
      " · " + (BIAS_NAME[rep.bias] || "--") + " (" + formatSigned(rep.difference) + ")</li>";
  }
  return html + "</ul>";
}
