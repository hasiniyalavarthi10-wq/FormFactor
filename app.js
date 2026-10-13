// FormFactor - app.js
// Runs the tool page: loads the uploaded video and plays it.
// (Pose detection and the skeleton overlay get added in step b.)

// ---- Page elements we need ----
const fileInput = document.getElementById("video-upload");
const liftSelect = document.getElementById("lift-type");
const analyzeButton = document.getElementById("analyze-button");
const statusText = document.getElementById("status");
const videoCard = document.getElementById("video-card");
const video = document.getElementById("video");

// Remembers the last temporary video URL so we can free it later
let currentVideoUrl = null;

// ---- Connect page events to our functions ----
fileInput.addEventListener("change", handleFileChosen);
video.addEventListener("loadedmetadata", handleVideoLoaded);
video.addEventListener("error", handleVideoError);
analyzeButton.addEventListener("click", handleAnalyzeClick);

// Shows a message under the Analyze button
function showStatus(message) {
  statusText.textContent = message;
}

// Runs when the user picks a file: loads it into the video player
function handleFileChosen() {
  const file = fileInput.files[0];
  if (!file) {
    return;
  }

  if (!file.type.startsWith("video/")) {
    showStatus("That file isn't a video. Please choose an .mp4, .mov, or .webm file.");
    return;
  }

  // Free the previous video's memory if the user picks a new one
  if (currentVideoUrl) {
    URL.revokeObjectURL(currentVideoUrl);
  }

  // Make a temporary URL that points to the file on this device.
  // The video is NOT uploaded anywhere.
  currentVideoUrl = URL.createObjectURL(file);
  video.src = currentVideoUrl;

  analyzeButton.disabled = true;
  showStatus("Loading video...");
}

// Runs once the browser knows the video's length and size
function handleVideoLoaded() {
  videoCard.classList.remove("hidden");
  analyzeButton.disabled = false;

  const seconds = video.duration.toFixed(1);
  showStatus("Video loaded: " + seconds + " seconds long. Choose the lift type, then click Analyze.");
}

// Runs if the browser can't play the file (for example, some iPhone .mov files)
function handleVideoError() {
  analyzeButton.disabled = true;
  showStatus("This browser can't play that video. Try converting it to .mp4 or recording in 'Most Compatible' mode.");
}

// Runs when Analyze is clicked. For now it just plays the video.
function handleAnalyzeClick() {
  const lift = liftSelect.value;
  showStatus("Analyzing a " + lift + " (pose detection is added in the next step).");
  video.currentTime = 0;
  video.play();
}
