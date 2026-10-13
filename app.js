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

// Words shown for the overall result and the muscle pattern
const OVERALL_TEXT = {
  safe: "Green: good form in this set",
  warning: "Yellow: some things to work on",
  danger: "Red: risky movement found"
};
const PATTERN_TEXT = {
  "quad-dominant": "Quad-dominant (knees bend more than hips; front of thighs work harder)",
  "posterior-chain-dominant": "Posterior-chain-dominant (hips bend more than knees; glutes, hamstrings, and back work harder)",
  "balanced": "Balanced (hips and knees bend about the same)",
  "unknown": "Unknown (body not clearly visible)"
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

// Works out the angles, speeds, and risk level for every recorded frame
function analyzeSet() {
  for (let i = 0; i < recordedFrames.length; i++) {
    const frame = recordedFrames[i];
    frame.kneeAngle = kneeAngle(frame.hip, frame.knee, frame.ankle);
    frame.hipAngle = calculateAngle(frame.shoulder, frame.hip, frame.knee);
    frame.trunkLean = trunkLeanAngle(frame.shoulder, frame.hip);

    // Speeds compare this frame to one about 0.2 seconds earlier.
    // (Comparing to the very last frame is too jumpy: MediaPipe's dots wiggle a little every frame.)
    const before = recordedFrames[frameBefore(i, SPEED_WINDOW_SECONDS)];
    frame.trunkSpeed = angularVelocity(before.trunkLean, frame.trunkLean, before.time, frame.time);
    frame.kneeSpeed = angularVelocity(before.kneeAngle, frame.kneeAngle, before.time, frame.time);

    frame.level = frameRiskLevel(frame, liftSelect.value);
  }

  // Squats only: find each rep's bottom, then check if it reached the depth goal
  repResults = [];
  if (liftSelect.value === "squat") {
    const bottoms = findRepBottoms(recordedFrames);
    for (let i = 0; i < bottoms.length; i++) {
      const bottomFrame = recordedFrames[bottoms[i]];
      repResults.push({
        time: bottomFrame.time,
        reached: reachedDepth(bottomFrame, depthSelect.value)
      });
    }
  }
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
  playbackDraw.font = "bold 34px sans-serif";
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

  // Muscle emphasis panel
  html = html + "<h3>Muscle emphasis</h3>" +
    "<p>Pattern: <strong>" + PATTERN_TEXT[muscleEmphasis(recordedFrames)] + "</strong></p>" +
    "<p>Lower-back load: <span class='dot " + lowerBackLoad(recordedFrames) + "'></span> <strong>" +
    lowerBackLoad(recordedFrames) + "</strong></p>";

  if (lift === "squat") {
    html = html + "<h3>Depth check</h3>" + depthListHtml();
  }

  html = html +
    "<p class='muted'><span class='dot safe'></span> safe &nbsp; <span class='dot warning'></span> warning &nbsp; " +
    "<span class='dot danger'></span> danger. This is an angular risk estimate based on published " +
    "biomechanics research, not a medical or force measurement.</p>";

  resultsBox.innerHTML = html;

  // The button only exists after the HTML above is added, so connect it now
  if (worstIndex !== -1) {
    document.getElementById("worst-frame-button").addEventListener("click", showWorstFrame);
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
    html = html + "<li>Rep " + (i + 1) + " at " + formatTime(rep.time) + ": " + message + "</li>";
  }
  return html + "</ul>";
}
