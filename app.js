// FormFactor - app.js
// Turns on the webcam, finds the body with MediaPipe, draws a skeleton live,
// and saves each frame's joint positions while a set is being recorded.

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

// ---- Page elements ----
const startCameraButton = document.getElementById("start-camera-button");
const liftSelect = document.getElementById("lift-type");
const setLengthSelect = document.getElementById("set-length");
const startSetButton = document.getElementById("start-set-button");
const stopSetButton = document.getElementById("stop-set-button");
const statusText = document.getElementById("status");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const draw = overlay.getContext("2d");
const countdownText = document.getElementById("countdown");
const resultsCard = document.getElementById("results-card");
const resultsBox = document.getElementById("results");

// ---- Things we remember while the page runs ----
let poseLandmarker = null;   // the MediaPipe pose detector
let lastVideoTime = -1;      // so we analyze each camera frame only once
let countdownTimer = null;   // the 1-second countdown timer
let stopTimer = null;        // the timer that ends the set
let isRecording = false;     // true while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds
let recordedFrames = [];     // saved data, one entry per frame

startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopSet);

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

  // Make the drawing layer the same pixel size as the camera image
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
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

// ======== FRAME LOOP ========

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
      drawSide(joints);
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

// Draws one straight line between two points
function drawLine(start, end, color, width) {
  draw.strokeStyle = color;
  draw.lineWidth = width;
  draw.beginPath();
  draw.moveTo(start.x, start.y);
  draw.lineTo(end.x, end.y);
  draw.stroke();
}

// Draws a thin white skeleton of the whole body (display only)
function drawFullBody(landmarks) {
  for (let i = 0; i < FULL_BODY_LINES.length; i++) {
    const start = toPixels(landmarks[FULL_BODY_LINES[i][0]]);
    const end = toPixels(landmarks[FULL_BODY_LINES[i][1]]);
    drawLine(start, end, "rgba(255,255,255,0.6)", 3);
  }
}

// Draws the analyzed side in bright blue: shoulder - hip - knee - ankle
function drawSide(joints) {
  drawLine(joints.shoulder, joints.hip, "#00e5ff", 6);
  drawLine(joints.hip, joints.knee, "#00e5ff", 6);
  drawLine(joints.knee, joints.ankle, "#00e5ff", 6);
}

// Saves one frame: time, side, four joints, and a small picture for the results
function saveFrame(joints, now) {
  recordedFrames.push({
    time: (now - recordingStartTime) / 1000,  // seconds since recording started
    side: joints.side,
    shoulder: joints.shoulder,
    hip: joints.hip,
    knee: joints.knee,
    ankle: joints.ankle,
    snapshot: takeSnapshot()
  });
}

// Makes a small JPEG picture of the video with the skeleton on top
function takeSnapshot() {
  const picture = document.createElement("canvas");
  picture.width = 320;
  picture.height = Math.round(320 * video.videoHeight / video.videoWidth);
  const pictureDraw = picture.getContext("2d");
  pictureDraw.drawImage(video, 0, 0, picture.width, picture.height);
  pictureDraw.drawImage(overlay, 0, 0, picture.width, picture.height);
  return picture.toDataURL("image/jpeg", 0.7);
}

// ======== SET TIMING ========

// "Start set" clicked: count down, then start recording
function startSet() {
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
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

  if (isRecording) {
    isRecording = false;
    showResults();
  } else {
    showStatus("Countdown cancelled.");
  }

  startSetButton.disabled = false;
  stopSetButton.disabled = true;
}

// ======== RESULTS (temporary: step d replaces this) ========

// Shows how many frames were saved and a picture from the middle of the set
function showResults() {
  showStatus("Set finished.");
  resultsCard.classList.remove("hidden");
  window.recordedFrames = recordedFrames;  // lets us look at the data in the console

  if (recordedFrames.length === 0) {
    resultsBox.innerHTML = "<p>No body found. Step back so your whole body is in view and try again.</p>";
    return;
  }

  const seconds = (performance.now() - recordingStartTime) / 1000;
  const middle = recordedFrames[Math.floor(recordedFrames.length / 2)];
  resultsBox.innerHTML =
    "<p>Saved <strong>" + recordedFrames.length + "</strong> frames " +
    "(about " + (recordedFrames.length / seconds).toFixed(1) + " per second). " +
    "Lift: " + liftSelect.value + ". Side: " + middle.side + ".</p>" +
    "<img class='snapshot' src='" + middle.snapshot + "' alt='Middle of the set'>";
}
