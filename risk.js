// risk.js
// decides if each part of the lift is "safe", "warning", or "danger"
//
// how i decided the rules:
// - red (danger) only happens when the chest drops forward FAST, because my research
//   says the real danger is the back angle changing in the middle of the lift
// - leaning a lot is only yellow, since how much you lean depends on how long your legs are


// all the numbers in one place
const LIMITS = {
  // from my research: safe trunk lean is about 15 to 45 degrees (squats only)
  maxLean: 45,

  // how fast the chest drops forward (degrees per second)
  // starting guesses, i still need to test these with good and bad squats
  fastDrop: 60,         // yellow
  veryFastDrop: 100,    // red

  // "hips rose first": knees straightening while the chest still drops forward
  kneesStraightening: 30,
  chestStillDropping: 10,

  // depth goals for the live depth bar (thigh angle, 0 = parallel)
  parallel: 0,
  deep: 15,

  // from Straub & Powers (2024): trunk and shin more than 10 degrees apart = hip or knee biased
  biasRange: 10
};


// true if the knees are straightening but the chest is still dropping forward
// (the hips shot up first, which puts the work on your lower back)
function hipsRoseFirst(frame) {
  return frame.kneeSpeed > LIMITS.kneesStraightening && frame.trunkSpeed > LIMITS.chestStillDropping;
}


// gives one frame a level: "safe", "warning", or "danger"
function getLevel(frame, lift) {
  if (frame.trunkSpeed > LIMITS.veryFastDrop) {
    return "danger";
  }
  if (frame.trunkSpeed > LIMITS.fastDrop) {
    return "warning";
  }
  if (hipsRoseFirst(frame)) {
    return "warning";
  }
  if (lift === "squat" && frame.trunkLean > LIMITS.maxLean) {
    return "warning";
  }
  return "safe";
}


// "hip-biased", "balanced", or "knee-biased" (Straub & Powers 2024)
// difference = trunk lean - shin lean
// this just shows which muscles did more work, it's not a danger thing
function getBias(difference) {
  if (difference > LIMITS.biasRange) {
    return "hip-biased";
  }
  if (difference < -LIMITS.biasRange) {
    return "knee-biased";
  }
  return "balanced";
}


// turns seconds into a time like "0:07"
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (secs < 10) {
    return minutes + ":0" + secs;
  }
  return minutes + ":" + secs;
}


// makes the list of tips shown in the results
function makeTips(frames, lift) {
  const tips = [];

  // find the frame where the chest dropped the fastest and the frame with the most lean
  let fastest = 0;
  let mostLean = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].trunkSpeed > frames[fastest].trunkSpeed) {
      fastest = i;
    }
    if (frames[i].trunkLean > frames[mostLean].trunkLean) {
      mostLean = i;
    }
  }

  if (frames[fastest].trunkSpeed > LIMITS.fastDrop) {
    tips.push("<b>" + formatTime(frames[fastest].time) + "</b>: Your chest dropped forward fast. " +
      "This strains your lower back. Try to keep your chest steady.");
  }

  // only tell them about the first time their hips rose first
  for (let i = 0; i < frames.length; i++) {
    if (hipsRoseFirst(frames[i])) {
      tips.push("<b>" + formatTime(frames[i].time) + "</b>: Your hips rose before your chest. " +
        "This moves the work from your legs to your lower back. Try to rise with chest and hips together.");
      break;
    }
  }

  if (lift === "squat" && frames[mostLean].trunkLean > LIMITS.maxLean) {
    tips.push("<b>" + formatTime(frames[mostLean].time) + "</b>: You leaned forward a lot (" +
      Math.round(frames[mostLean].trunkLean) + "°). Some lean is normal, but less is easier on your back.");
  }

  if (tips.length === 0) {
    tips.push("No problems found. Nice work!");
  }
  return tips;
}
