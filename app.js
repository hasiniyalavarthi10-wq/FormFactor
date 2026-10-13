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
// The live view averages this many frames so its numbers don't flicker
const LIVE_SMOOTH_FRAMES = 5;

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
let stopTimer = null;        // the timer that ends the set
let playbackTimer = null;    // the timer that shows the next playback frame
let isRecording = false;     // true while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds
let recordedFrames = [];     // saved data, one entry per frame
let repResults = [];         // one entry per squat rep: when, how deep, trunk-vs-shin, and change from rep 1
let worstIndex = -1;         // frame number of the worst moment (-1 = none)
let setDifference = NaN;     // average trunk-minus-shin angle at the bottom of the squat reps
let liveTrunk = [];          // the last few live trunk angles, for smoothing
let liveShin = [];           // the last few live shin angles, for smoothing

startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopSet);
analyzeButton.addEventListener("click", openResults);
replayButton.addEventListener("click", replay);
worstFrameButton.addEventListener("click", showWorstFrame);
recordAgainButton.addEventListener("click", backToRecording);

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

  // Trunk vs. shin comparison (the muscle-emphasis panel)
  html = html + "<h3>Trunk vs. shin</h3>" + biasHtml(lift);

  // Lower-back load
  html = html + "<h3>Lower-back load</h3>" +
    "<p><span class='dot " + lowerBackLoad(recordedFrames) + "'></span> <strong>" +
    lowerBackLoad(recordedFrames) + "</strong> (based on how fast your trunk angle changed)</p>";

  if (lift === "squat") {
    html = html + "<h3>Rep by rep (compared to rep 1)</h3>" + repTableHtml();
  }

  html = html +
    "<p class='muted'><span class='dot safe'></span> safe &nbsp; <span class='dot warning'></span> warning &nbsp; " +
    "<span class='dot danger'></span> danger. This is an angular risk estimate based on published " +
    "biomechanics research, not a medical or force measurement.</p>";

  resultsBox.innerHTML = html;

  // The chart only exists after the HTML above is added, so draw it now
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
    "<tr><th>Rep</th><th>Time</th><th>Depth</th><th>vs. rep 1</th><th>Trunk − Shin</th><th>vs. rep 1</th></tr>";

  for (let i = 0; i < repResults.length; i++) {
    const rep = repResults[i];
    let depthChangeText = "—";
    let patternChangeText = "—";
    if (i > 0) {
      depthChangeText = changeCell(rep.depthChange, isLessDeep(rep));
      patternChangeText = changeCell(rep.patternChange, isPatternShift(rep));
    }
    html = html + "<tr>" +
      "<td>" + (i + 1) + "</td>" +
      "<td>" + formatTime(rep.time) + "</td>" +
      "<td>" + formatSigned(rep.depth) + "</td>" +
      "<td>" + depthChangeText + "</td>" +
      "<td>" + formatSigned(rep.difference) + "<br><span class='muted'>" + (BIAS_NAME[rep.bias] || "--") + "</span></td>" +
      "<td>" + patternChangeText + "</td>" +
      "</tr>";
  }

  html = html + "</table></div>" +
    "<p class='muted'>Depth is your thigh angle at the bottom of the rep: 0° = thigh level (parallel), " +
    "+ = hip below knee, − = hip above knee. Each rep is compared to your first rep, so the app can spot " +
    "changes during the set (like getting less deep as you tire) without needing to know your depth goal. " +
    "A yellow dot means the change was more than " + THRESHOLDS.depthChangeWarning + "°.</p>";
  return html;
}

// Makes one "vs. rep 1" cell: the signed change, with a yellow dot if it's a big change
function changeCell(change, isBig) {
  if (isBig) {
    return "<span class='dot warning'></span> " + formatSigned(change);
  }
  return formatSigned(change);
}
