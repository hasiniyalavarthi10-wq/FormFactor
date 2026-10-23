// analyze.js
// everything on the analyze page (camera, lines, recording, playback, results)

// MediaPipe finds the body points for us
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

const COUNTDOWN = 5;     // seconds before recording starts
const MAX_TIME = 300;    // stop recording after 5 minutes so the browser doesn't run out of memory
const CUT_END = 2;       // seconds cut off the end (that's you walking over to click Stop)

// MediaPipe numbers 33 body points. these are the ones we use for each side
const LEFT = { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { shoulder: 12, hip: 24, knee: 26, ankle: 28 };

// pairs of points to connect for the thin white full-body skeleton
const BODY_LINES = [
  [11, 12], [23, 24],                       // shoulders, hips
  [11, 13], [13, 15], [12, 14], [14, 16],   // arms
  [11, 23], [23, 25], [25, 27],             // left side
  [12, 24], [24, 26], [26, 28]              // right side
];

// line colors
const COLORS = { safe: "#00c853", warning: "#ffd600", danger: "#ff1744" };
const BLUE = "#00e5ff";

// words for the results
const OVERALL_TEXT = {
  safe: "Good form",
  warning: "Pretty good, a few things to watch",
  danger: "Careful: risky movement spotted"
};
const BACK_TEXT = { safe: "Low strain", warning: "Some strain", danger: "High strain" };
const BIAS_NAME = { "hip-biased": "More hips", "balanced": "Even", "knee-biased": "More knees" };
const BIAS_TEXT = {
  "hip-biased": "<b>Your hips did more of the work.</b> You leaned your chest forward more than your shins, so your glutes and hamstrings worked harder.",
  "balanced": "<b>Your hips and knees shared the work evenly.</b> Your chest and shins leaned about the same.",
  "knee-biased": "<b>Your knees did more of the work.</b> Your shins leaned forward more than your chest, so your quads (front of thighs) worked harder."
};

// grab everything we need from the page
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
const worstButton = document.getElementById("worst-frame-button");
const recordAgainButton = document.getElementById("record-again-button");
const playbackStatus = document.getElementById("playback-status");
const resultsBox = document.getElementById("results");

// stuff we need to remember
let poseLandmarker = null;
let lastVideoTime = -1;
let countdownTimer = null;
let clockTimer = null;
let maxTimer = null;
let playbackTimer = null;
let isRecording = false;
let startTime = 0;
let frames = [];       // everything we saved while recording, one item per frame
let worstIndex = -1;   // frame number of the worst moment (-1 means there wasn't one)
let liveTrunk = [];    // last few live angles, used to stop the numbers from flickering
let liveShin = [];
let liveDepth = [];

startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopSet);
analyzeButton.addEventListener("click", openResults);
replayButton.addEventListener("click", replay);
worstButton.addEventListener("click", showWorstFrame);
recordAgainButton.addEventListener("click", backToRecording);
liftSelect.addEventListener("change", showDepthChoice);


function showStatus(message) {
  statusText.textContent = message;
}

// only show the depth goal dropdown for squats
function showDepthChoice() {
  if (liftSelect.value === "squat") {
    depthChoice.classList.remove("hidden");
  } else {
    depthChoice.classList.add("hidden");
  }
}

// shows the big countdown number on the video ("" makes it disappear)
function showCountdown(text) {
  countdownText.textContent = text;
}



// turn on the camera, load MediaPipe, then start the loop
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

  // make the drawing layers the same size as the camera picture
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  playback.width = video.videoWidth;
  playback.height = video.videoHeight;
  startCameraButton.disabled = true;

  showStatus("Loading the pose model (can take about 10 seconds)...");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    runningMode: "VIDEO",
    numPoses: 1
  });

  startSetButton.disabled = false;
  showStatus("Ready. Stand sideways with your whole body in view, then click Start set.");
  requestAnimationFrame(loop);
}


// runs over and over: find the body, draw it, and save it if we're recording
function loop() {
  // only do this when the camera has a new picture
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    draw.clearRect(0, 0, overlay.width, overlay.height);

    if (result.landmarks.length > 0) {
      const points = result.landmarks[0];
      const joints = getJoints(points);
      drawBody(points);

      const trunk = smoothLive(liveTrunk, leanAngle(joints.shoulder, joints.hip));
      const shin = smoothLive(liveShin, leanAngle(joints.knee, joints.ankle));
      drawAngles(draw, joints, trunk, shin, BLUE);

      if (liftSelect.value === "squat") {
        drawDepthBar(smoothLive(liveDepth, thighAngle(joints.hip, joints.knee)));
      }

      // only save frames where the body is clearly visible
      if (isRecording && joints.visible) {
        saveFrame(joints, now);
      }
    }
  }
  requestAnimationFrame(loop);
}


// picks the side of the body the camera can see better and gets its 4 joints in pixels
function getJoints(points) {
  const leftScore = points[11].visibility + points[23].visibility + points[25].visibility + points[27].visibility;
  const rightScore = points[12].visibility + points[24].visibility + points[26].visibility + points[28].visibility;

  let side = LEFT;
  if (rightScore > leftScore) {
    side = RIGHT;
  }

  return {
    shoulder: toPixels(points[side.shoulder]),
    hip: toPixels(points[side.hip]),
    knee: toPixels(points[side.knee]),
    ankle: toPixels(points[side.ankle]),
    // visible = MediaPipe is pretty sure about all 4 points (each one is 0 to 1)
    visible: Math.max(leftScore, rightScore) > 2.8
  };
}


// MediaPipe gives x and y from 0 to 1, so change them into pixels
// (if you skip this the angles are wrong since the picture is wider than it is tall)
function toPixels(point) {
  return { x: point.x * video.videoWidth, y: point.y * video.videoHeight };
}



function drawLine(canvas, start, end, color, width) {
  canvas.strokeStyle = color;
  canvas.lineWidth = width;
  canvas.beginPath();
  canvas.moveTo(start.x, start.y);
  canvas.lineTo(end.x, end.y);
  canvas.stroke();
}

// white text with a black outline so you can read it on any background
function drawText(canvas, text, x, y, align) {
  canvas.font = "bold " + textSize() + "px Bitter, serif";
  canvas.textAlign = align;
  canvas.lineWidth = 6;
  canvas.strokeStyle = "black";
  canvas.fillStyle = "white";
  canvas.strokeText(text, x, y);
  canvas.fillText(text, x, y);
}

// a see-through bar across the picture with text in the middle
function drawBar(canvas, text, y, height, color) {
  canvas.fillStyle = color;
  canvas.fillRect(0, y, canvas.canvas.width, height);
  drawText(canvas, text, canvas.canvas.width / 2, y + height * 0.7, "center");
}

// bigger camera picture = bigger text
function textSize() {
  return Math.round(video.videoHeight / 22);
}

// thin white skeleton for the whole body (just for looks)
function drawBody(points) {
  for (let i = 0; i < BODY_LINES.length; i++) {
    const start = toPixels(points[BODY_LINES[i][0]]);
    const end = toPixels(points[BODY_LINES[i][1]]);
    drawLine(draw, start, end, "rgba(255,255,255,0.6)", 3);
  }
}

// draws the trunk and shin lines like the picture in the Straub & Powers paper
function drawAngles(canvas, joints, trunk, shin, color) {
  drawLine(canvas, joints.hip, joints.knee, color, 4);
  drawLine(canvas, joints.hip, joints.shoulder, color, 8);
  drawLine(canvas, joints.ankle, joints.knee, color, 8);

  // straight up lines
  const aboveHip = { x: joints.hip.x, y: joints.shoulder.y };
  const aboveAnkle = { x: joints.ankle.x, y: joints.knee.y };
  drawLine(canvas, joints.hip, aboveHip, "white", 4);
  drawLine(canvas, joints.ankle, aboveAnkle, "white", 4);

  // put the numbers on the opposite side from where the body is leaning
  const size = textSize();
  if (joints.shoulder.x > joints.hip.x) {
    drawText(canvas, formatAngle(trunk, false), aboveHip.x - 12, aboveHip.y + size, "right");
  } else {
    drawText(canvas, formatAngle(trunk, false), aboveHip.x + 12, aboveHip.y + size, "left");
  }
  if (joints.knee.x > joints.ankle.x) {
    drawText(canvas, formatAngle(shin, false), aboveAnkle.x - 12, aboveAnkle.y + size, "right");
  } else {
    drawText(canvas, formatAngle(shin, false), aboveAnkle.x + 12, aboveAnkle.y + size, "left");
  }

  // bottom bar
  let text = "Trunk - Shin = " + formatAngle(trunk - shin, true);
  if (liftSelect.value === "squat") {
    text = text + "  " + BIAS_NAME[getBias(trunk - shin)];
  }
  drawBar(canvas, text, canvas.canvas.height - size * 1.8, size * 1.8, "rgba(0,0,0,0.6)");
}

// bar at the top of the live camera that turns green when you hit your depth goal
function drawDepthBar(depth) {
  let goal = LIMITS.parallel;
  let goalName = "Parallel";
  if (depthSelect.value === "deep") {
    goal = LIMITS.deep;
    goalName = "Deep";
  }

  const size = textSize();
  if (depth >= goal) {
    drawBar(draw, goalName + " reached!", 0, size * 1.8, "rgba(0,160,70,0.85)");
  } else {
    drawBar(draw, "Depth " + formatAngle(depth, true) + "  (goal: " + goalName + ")", 0, size * 1.8, "rgba(0,0,0,0.6)");
  }
}

// turns an angle into text like "42°" (or "+12°" if plus is true)
function formatAngle(angle, plus) {
  if (isNaN(angle)) {
    return "--";
  }
  if (plus && angle > 0) {
    return "+" + Math.round(angle) + "°";
  }
  return Math.round(angle) + "°";
}

// averages the last 5 live angles so the numbers don't jump around
function smoothLive(list, angle) {
  list.push(angle);
  if (list.length > 5) {
    list.shift();
  }
  let total = 0;
  for (let i = 0; i < list.length; i++) {
    total = total + list[i];
  }
  return total / list.length;
}



// saves the time, the 4 joints, and a small picture for the playback
function saveFrame(joints, now) {
  const small = document.createElement("canvas");
  small.width = 360;
  small.height = Math.round(360 * video.videoHeight / video.videoWidth);
  small.getContext("2d").drawImage(video, 0, 0, small.width, small.height);

  const picture = new Image();
  picture.src = small.toDataURL("image/jpeg", 0.6);

  frames.push({
    time: (now - startTime) / 1000,
    shoulder: joints.shoulder,
    hip: joints.hip,
    knee: joints.knee,
    ankle: joints.ankle,
    picture: picture
  });
}

// "Start set": count down from 5, then start recording
function startSet() {
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
  analyzeButton.disabled = true;

  let secondsLeft = COUNTDOWN;
  showCountdown(secondsLeft);
  showStatus("Get into position... recording starts in " + secondsLeft);

  countdownTimer = setInterval(function () {
    secondsLeft = secondsLeft - 1;
    showCountdown(secondsLeft);
    showStatus("Get into position... recording starts in " + secondsLeft);
    if (secondsLeft === 0) {
      clearInterval(countdownTimer);
      startRecording();
    }
  }, 1000);
}

function startRecording() {
  showCountdown("");
  frames = [];
  isRecording = true;
  startTime = performance.now();
  showStatus("Recording 0:00. Lift now! Click Stop when you're done.");

  // update the timer every second
  clockTimer = setInterval(function () {
    const seconds = (performance.now() - startTime) / 1000;
    showStatus("Recording " + formatTime(seconds) + ". Click Stop when you're done.");
  }, 1000);

  // stop by itself after 5 minutes
  maxTimer = setTimeout(stopSet, MAX_TIME * 1000);
}

// "Stop" (or the 5 minutes ran out)
function stopSet() {
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

  // cut off the last 2 seconds (walking over to the laptop)
  if (frames.length > 0) {
    const cutTime = frames[frames.length - 1].time - CUT_END;
    while (frames.length > 0 && frames[frames.length - 1].time > cutTime) {
      frames.pop();
    }
  }

  if (frames.length === 0) {
    showStatus("Nothing to analyze. Make sure your whole body is in view, and record a bit longer.");
    return;
  }

  analyzeButton.disabled = false;
  showStatus("Set recorded (" + formatTime(frames[frames.length - 1].time) + "). Click Analyze to see your results.");
}



// works out the angles, speeds, and levels for every frame
function analyzeSet() {
  const lift = liftSelect.value;

  // 1. angles for every frame
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    f.rawKnee = calculateAngle(f.hip, f.knee, f.ankle);
    f.rawHip = calculateAngle(f.shoulder, f.hip, f.knee);
    f.rawTrunk = leanAngle(f.shoulder, f.hip);
    f.rawShin = leanAngle(f.knee, f.ankle);
  }

  // 2. smooth them out so one wobbly dot doesn't mess things up
  for (let i = 0; i < frames.length; i++) {
    frames[i].kneeAngle = smooth(i, "rawKnee");
    frames[i].hipAngle = smooth(i, "rawHip");
    frames[i].trunkLean = smooth(i, "rawTrunk");
    frames[i].shinAngle = smooth(i, "rawShin");
  }

  // 3. speeds (compared to 6 frames ago, about 0.2 seconds) and the level for each frame
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const before = frames[Math.max(0, i - 6)];
    f.trunkSpeed = angleSpeed(before.trunkLean, f.trunkLean, before.time, f.time);
    f.kneeSpeed = angleSpeed(before.kneeAngle, f.kneeAngle, before.time, f.time);
    f.difference = f.trunkLean - f.shinAngle;
    f.level = getLevel(f, lift);
  }
}

// average of an angle with the 3 frames before and after it
// (frames[j][name] means frames[j].rawKnee, frames[j].rawHip, etc.)
function smooth(i, name) {
  let total = 0;
  let count = 0;
  for (let j = i - 3; j <= i + 3; j++) {
    if (j >= 0 && j < frames.length) {
      total = total + frames[j][name];
      count = count + 1;
    }
  }
  return total / count;
}



// "Analyze": do the math, switch screens, and play it back
function openResults() {
  analyzeSet();
  recordView.classList.add("hidden");
  resultsView.classList.remove("hidden");
  window.scrollTo(0, 0);
  showResults();
  replay();
}

// "Record another set": go back to the camera screen
function backToRecording() {
  clearTimeout(playbackTimer);
  resultsView.classList.add("hidden");
  recordView.classList.remove("hidden");
  window.scrollTo(0, 0);
  showStatus("Ready. Click Start set to record another set.");
}

function replay() {
  clearTimeout(playbackTimer);
  playFrame(0);
}

// shows one frame, then waits until it's time for the next one
function playFrame(i) {
  drawPlaybackFrame(frames[i]);
  playbackStatus.textContent = "Playback: " + formatTime(frames[i].time);

  if (i + 1 < frames.length) {
    const wait = (frames[i + 1].time - frames[i].time) * 1000;
    playbackTimer = setTimeout(function () {
      playFrame(i + 1);
    }, wait);
  } else {
    playbackStatus.textContent = "Playback finished.";
  }
}

// one saved frame: the picture, the colored lines, and the angles
function drawPlaybackFrame(f) {
  playbackDraw.drawImage(f.picture, 0, 0, playback.width, playback.height);
  drawAngles(playbackDraw, f, f.trunkLean, f.shinAngle, COLORS[f.level]);
  drawText(playbackDraw, "Hip " + formatAngle(f.hipAngle, false), f.hip.x + 18, f.hip.y, "left");
  drawText(playbackDraw, "Knee " + formatAngle(f.kneeAngle, false), f.knee.x + 18, f.knee.y, "left");
}

function showWorstFrame() {
  if (worstIndex === -1) {
    return;
  }
  clearTimeout(playbackTimer);
  drawPlaybackFrame(frames[worstIndex]);
  playbackStatus.textContent = "Worst moment, at " + formatTime(frames[worstIndex].time) + ". Click Replay to watch it all again.";
}

// fills in the results on the right side
function showResults() {
  const lift = liftSelect.value;

  // the worst level in the whole set = the lower back result
  let back = "safe";
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].level === "danger") {
      back = "danger";
    } else if (frames[i].level === "warning" && back === "safe") {
      back = "warning";
    }
  }

  // worst moment = the flagged frame where the chest moved fastest
  worstIndex = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].level !== "safe") {
      if (worstIndex === -1 || frames[i].trunkSpeed > frames[worstIndex].trunkSpeed) {
        worstIndex = i;
      }
    }
  }
  if (worstIndex === -1) {
    worstButton.disabled = true;
    worstButton.textContent = "No worst moment";
  } else {
    worstButton.disabled = false;
    worstButton.textContent = "Show worst moment (" + formatTime(frames[worstIndex].time) + ")";
  }

  // build the html
  let html = "<div class='overall " + back + "'>" + OVERALL_TEXT[back] + "</div>";

  const tips = makeTips(frames, lift);
  html = html + "<ul class='flags'>";
  for (let i = 0; i < tips.length; i++) {
    html = html + "<li>" + tips[i] + "</li>";
  }
  html = html + "</ul>";

  // rep counter and how deep each rep was compared to the first one
  if (lift === "squat") {
    html = html + "<h3>Reps: " + countReps(frames) + "</h3>";
    html = html + depthList();
  }

  html = html + "<h3>Which muscles worked more?</h3>";
  if (lift === "squat") {
    // look at the deepest point of the set (where the hip is lowest, bigger y = lower)
    let deepest = 0;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].hip.y > frames[deepest].hip.y) {
        deepest = i;
      }
    }
    const difference = frames[deepest].difference;

    html = html + "<p>" + BIAS_TEXT[getBias(difference)] + "</p>" +
      "<p class='muted'>(Chest lean minus shin lean at your deepest point: " + formatAngle(difference, true) +
      ". Based on Straub &amp; Powers, 2024.)</p>";
  } else {
    html = html + "<p class='muted'>Only shown for squats.</p>";
  }

  html = html + "<h3>Lower back</h3>" +
    "<p><span class='dot " + back + "'></span> <b>" + BACK_TEXT[back] + "</b>" +
    " <span class='muted'>(from how fast your chest moved)</span></p>";

  html = html + "<p class='muted'><span class='dot safe'></span> good &nbsp; " +
    "<span class='dot warning'></span> watch this &nbsp; <span class='dot danger'></span> careful. " +
    "An estimate from your body angles, based on published research.</p>";

  resultsBox.innerHTML = html;
}

// list of how deep each rep was, compared to the first rep
// depth = thigh angle at the bottom (0 = parallel, + = deeper, - = higher)
function depthList() {
  const reps = findReps(frames);
  if (reps.length < 2) {
    return "";
  }

  const first = frames[reps[0]];
  const firstDepth = thighAngle(first.hip, first.knee);
  let html = "<p><b>Depth compared to your first rep:</b></p><ul>";

  for (let i = 0; i < reps.length; i++) {
    const f = frames[reps[i]];
    const depth = thighAngle(f.hip, f.knee);
    const change = depth - firstDepth;

    let words = "";
    if (i == 0) {
      words = "first rep";
    } else if (Math.abs(change) < 3) {
      words = "about the same";
    } else if (change < 0) {
      words = Math.round(-change) + "° shallower";
    } else {
      words = Math.round(change) + "° deeper";
    }

    // yellow dot if it was a lot shallower (you might be getting tired)
    let dot = "";
    if (change < -10) {
      dot = "<span class='dot warning'></span> ";
    }

    html = html + "<li>" + dot + "Rep " + (i + 1) + ": " + formatAngle(depth, true) + " (" + words + ")</li>";
  }

  return html + "</ul><p class='muted'>0° = thighs level with the floor, + = deeper, - = higher.</p>";
}
