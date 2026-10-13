// FormFactor - app.js
// Runs the tool page: turns on the webcam, counts down, and times one set.
// (Pose detection and the skeleton overlay get added in step b.)

// How many seconds the countdown lasts before recording starts
const COUNTDOWN_SECONDS = 5;

// ---- Page elements we need ----
const startCameraButton = document.getElementById("start-camera-button");
const liftSelect = document.getElementById("lift-type");
const setLengthSelect = document.getElementById("set-length");
const startSetButton = document.getElementById("start-set-button");
const stopSetButton = document.getElementById("stop-set-button");
const statusText = document.getElementById("status");
const videoCard = document.getElementById("video-card");
const video = document.getElementById("video");
const countdownText = document.getElementById("countdown");

// ---- Things we need to remember while the page runs ----
let countdownTimer = null;   // the repeating 1-second countdown timer
let stopTimer = null;        // the timer that ends the set automatically
let isRecording = false;     // true only while a set is being recorded
let recordingStartTime = 0;  // when recording began, in milliseconds

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

// Asks the browser for the webcam and shows it in the video element
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

    videoCard.classList.remove("hidden");
    startCameraButton.disabled = true;
    startSetButton.disabled = false;
    showStatus("Camera is on. Check that your whole body is in the picture, then click Start set.");
  } catch (error) {
    showCameraError(error);
  }
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

// Runs when "Start set" is clicked: starts the countdown
function startSet() {
  startSetButton.disabled = true;
  stopSetButton.disabled = false;
  liftSelect.disabled = true;
  setLengthSelect.disabled = true;

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
    showStatus("Set finished: " + secondsRecorded.toFixed(1) + " seconds recorded. (Analysis is added in the next steps.)");
  } else {
    showStatus("Countdown cancelled.");
  }

  isRecording = false;
  startSetButton.disabled = false;
  stopSetButton.disabled = true;
  liftSelect.disabled = false;
  setLengthSelect.disabled = false;
}
