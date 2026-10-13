// FormFactor - app.js
// Runs the tool page: turns on the webcam, finds the body with MediaPipe,
// draws a skeleton live, and saves each frame's joint positions during a set.

// MediaPipe pose detection, loaded from a CDN (version pinned so it can't change on us)
import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// Where MediaPipe's engine files and the pose model live
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

// How many seconds the countdown lasts before recording starts
const COUNTDOWN_SECONDS = 5;

// MediaPipe numbers 33 body points. These are the ones we use for each side.
const LEFT_SIDE = { shoulder: 11, hip: 23, knee: 25, ankle: 27 };
const RIGHT_SIDE = { shoulder: 12, hip: 24, knee: 26, ankle: 28 };

// ---- Page elements we need ----
const startCameraButton = document.getElementById("start-camera-button");
const liftSelect = document.getElementById("lift-type");
const setLengthSelect = document.getElementById("set-length");
const startSetButton = document.getElementById("start-set-button");
const stopSetButton = document.getElementById("stop-set-button");
const statusText = document.getElementById("status");
const videoCard = document.getElementById("video-card");
const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const overlayContext = overlay.getContext("2d");
const countdownText = document.getElementById("countdown");
const resultsCard = document.getElementById("results-card");
const resultsBox = document.getElementById("results");

// A hidden canvas used to make small snapshot pictures of frames
const snapshotCanvas = document.createElement("canvas");
const snapshotContext = snapshotCanvas.getContext("2d");

// ---- Things we need to remember while the page runs ----
let poseLandmarker = null;   // the MediaPipe pose detector, once loaded
let lastVideoTime = -1;      // so we only analyze each camera frame once
let countdownTimer = null;   // the repeating 1-second countdown timer
let stopTimer = null;        // the timer that ends the set automatically
let isRecording = false;     // true only while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds
let recordedFrames = [];     // one entry per frame where a body was found
let framesSeen = 0;          // all frames during recording, even with no body found

// ---- Connect buttons to our functions ----
startCameraButton.addEventListener("click", startCamera);
startSetButton.addEventListener("click", startSet);
stopSetButton.addEventListener("click", stopSet);

// Shows a message under the buttons
function showStatus(message) {
  statusText.textContent = message;
}

// Shows big text (like "3" or "GO") on top of the video, or hides it if text is empty
function showCountdown(text) {
  countdownText.textContent = text;
  if (text === "") {
    countdownText.classList.add("hidden");
  } else {
    countdownText.classList.remove("hidden");
  }
}

// ======================================================
// CAMERA + MODEL SETUP
// ======================================================

// Turns on the webcam, then loads the pose model and starts the frame loop
async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showStatus("This browser can't use the camera here. Use Chrome, Edge, or Safari, on https or localhost.");
    return;
  }

  showStatus("Asking for camera permission...");

  try {
    // Ask for video only (no microphone). "ideal" means: use this size if the camera supports it.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    showCameraError(error);
    return;
  }

  // Make the drawing canvas the same size (in pixels) as the camera image
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;

  videoCard.classList.remove("hidden");
  startCameraButton.disabled = true;

  try {
    await loadPoseModel();
  } catch (error) {
    console.error(error);
    showStatus("Couldn't load the pose model. Check your internet connection and reload the page.");
    return;
  }

  startSetButton.disabled = false;
  showStatus("Ready. Step back until the skeleton covers your shoulder, hip, knee, and ankle, then click Start set.");
  requestAnimationFrame(processFrame);
}

// Turns a camera error into a message a user can act on
function showCameraError(error) {
  if (error.name === "NotAllowedError") {
    showStatus("Camera permission was blocked. Click the camera icon in the address bar, allow it, and try again.");
  } else if (error.name === "NotFoundError") {
    showStatus("No camera was found on this device.");
  } else if (error.name === "NotReadableError") {
    showStatus("The camera is being used by another app (like Zoom). Close it and try again.");
  } else {
    showStatus("Couldn't start the camera: " + error.message);
  }
}

// Downloads MediaPipe's engine and the pose model (runs once)
async function loadPoseModel() {
  showStatus("Loading the pose model (the first time can take about 10 seconds)...");
  const vision = await FilesetResolver.forVisionTasks(WASM_URL);

  // Try the graphics card (fast). If this computer can't, use the regular processor.
  try {
    poseLandmarker = await createPoseLandmarker(vision, "GPU");
  } catch (error) {
    console.warn("GPU not available, using CPU instead.", error);
    poseLandmarker = await createPoseLandmarker(vision, "CPU");
  }
}

// Creates the pose detector with our settings
function createPoseLandmarker(vision, processor) {
  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: processor },
    runningMode: "VIDEO",  // we give it frames one after another, like a video
    numPoses: 1            // only look for one person
  });
}

// ======================================================
// FRAME LOOP: runs every time the screen refreshes
// ======================================================

// Finds the body in the current camera frame, draws it, and saves it if recording
function processFrame() {
  // Only analyze a frame once (the screen can refresh faster than the camera)
  if (video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const now = performance.now();
    const result = poseLandmarker.detectForVideo(video, now);

    overlayContext.clearRect(0, 0, overlay.width, overlay.height);

    if (isRecording) {
      framesSeen = framesSeen + 1;
    }

    // result.landmarks is a list of people found; we asked for at most 1
    if (result.landmarks.length > 0) {
      const joints = getBestSideJoints(result.landmarks[0]);
      drawSkeleton(joints);
      if (isRecording) {
        saveFrame(joints, now);
      }
    }
  }

  // Ask the browser to run this function again on the next screen refresh
  requestAnimationFrame(processFrame);
}

// Adds up how visible (0 to 1) the four joints on one side are
function sideVisibility(landmarks, side) {
  return landmarks[side.shoulder].visibility
       + landmarks[side.hip].visibility
       + landmarks[side.knee].visibility
       + landmarks[side.ankle].visibility;
}

// Picks the side of the body facing the camera and returns its four joints in pixels
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

// MediaPipe gives x and y from 0 to 1. This converts them to real pixel positions.
// (Important: without this, angles would be wrong because width and height differ.)
function toPixels(landmark) {
  return {
    x: landmark.x * video.videoWidth,
    y: landmark.y * video.videoHeight,
    visibility: landmark.visibility
  };
}

// Draws lines shoulder -> hip -> knee -> ankle, plus a dot on each joint
function drawSkeleton(joints) {
  const points = [joints.shoulder, joints.hip, joints.knee, joints.ankle];

  overlayContext.strokeStyle = "#00e5ff";
  overlayContext.lineWidth = 6;
  overlayContext.beginPath();
  overlayContext.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    overlayContext.lineTo(points[i].x, points[i].y);
  }
  overlayContext.stroke();

  overlayContext.fillStyle = "#ffffff";
  for (let i = 0; i < points.length; i++) {
    overlayContext.beginPath();
    overlayContext.arc(points[i].x, points[i].y, 9, 0, 2 * Math.PI);
    overlayContext.fill();
  }
}

// Saves one frame's data: time, side, the four joints, and a small picture
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

// Makes a small JPEG picture of the video with the skeleton drawn on it
function takeSnapshot() {
  snapshotCanvas.width = 320;
  snapshotCanvas.height = Math.round(320 * video.videoHeight / video.videoWidth);
  snapshotContext.drawImage(video, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  snapshotContext.drawImage(overlay, 0, 0, snapshotCanvas.width, snapshotCanvas.height);
  return snapshotCanvas.toDataURL("image/jpeg", 0.7);
}

// ======================================================
// SET TIMING: countdown, record, stop
// ======================================================

// Runs when "Start set" is clicked: starts the countdown
function startSet() {
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
  liftSelect.disabled = true;
  setLengthSelect.disabled = true;
  resultsCard.classList.add("hidden");

  let secondsLeft = COUNTDOWN_SECONDS;
  showCountdown(String(secondsLeft));
  showStatus("Get into position... recording starts in " + secondsLeft);

  // Every 1000 ms (1 second), count down by one
  countdownTimer = setInterval(function () {
    secondsLeft = secondsLeft - 1;
    if (secondsLeft > 0) {
      showCountdown(String(secondsLeft));
      showStatus("Get into position... recording starts in " + secondsLeft);
    } else {
      clearInterval(countdownTimer);
      countdownTimer = null;
      beginRecording();
    }
  }, 1000);
}

// Starts the recording part of the set and schedules the automatic stop
function beginRecording() {
  recordedFrames = [];
  framesSeen = 0;
  isRecording = true;
  recordingStartTime = performance.now();
  showCountdown("GO");

  // Hide "GO" after 1 second so it doesn't cover the lifter
  setTimeout(function () {
    if (isRecording) {
      showCountdown("");
    }
  }, 1000);

  const setSeconds = Number(setLengthSelect.value);
  showStatus("Recording a " + liftSelect.value + " for " + setSeconds + " seconds. Lift now!");

  // Stop automatically when the chosen time is up
  stopTimer = setTimeout(stopSet, setSeconds * 1000);
}

// Ends the set (automatically, or when Stop is clicked) and resets the buttons
function stopSet() {
  // Cancel any timers that are still waiting
  clearInterval(countdownTimer);
  clearTimeout(stopTimer);
  countdownTimer = null;
  stopTimer = null;
  showCountdown("");

  if (isRecording) {
    const secondsRecorded = (performance.now() - recordingStartTime) / 1000;
    showStatus("Set finished: " + secondsRecorded.toFixed(1) + " seconds recorded.");
    showRecordingSummary(secondsRecorded);
  } else {
    showStatus("Countdown cancelled.");
  }

  isRecording = false;
  startSetButton.disabled = false;
  stopSetButton.disabled = true;
  liftSelect.disabled = false;
  setLengthSelect.disabled = false;
}

// ======================================================
// RESULTS (temporary: step d replaces this with the real analysis)
// ======================================================

// Shows how many frames were captured and one sample snapshot
function showRecordingSummary(secondsRecorded) {
  resultsCard.classList.remove("hidden");

  // Make the data available in the browser console for testing angles.js later
  window.recordedFrames = recordedFrames;
  console.log("Recorded frames:", recordedFrames);

  if (recordedFrames.length === 0) {
    resultsBox.innerHTML = "<p>No body was found in any frame. Step back so your whole body is in view, and try again.</p>";
    return;
  }

  const framesPerSecond = recordedFrames.length / secondsRecorded;
  const middleFrame = recordedFrames[Math.floor(recordedFrames.length / 2)];

  resultsBox.innerHTML =
    "<p>Body found in <strong>" + recordedFrames.length + "</strong> of " + framesSeen + " frames " +
    "(about " + framesPerSecond.toFixed(1) + " frames per second).</p>" +
    "<p>Side used in the middle frame: <strong>" + middleFrame.side + "</strong>.</p>" +
    "<p>Middle frame, at " + middleFrame.time.toFixed(2) + " seconds:</p>" +
    "<img class='snapshot' src='" + middleFrame.snapshot + "' alt='Snapshot from the middle of the set'>";
}
