const LIMITS = {
  maxLean: 45,

  fastDrop: 60,
  veryFastDrop: 100,

  kneesStraightening: 30,
  chestStillDropping: 10,

  parallel: 0,
  deep: 15,

  biasRange: 10
};

function hipsRoseFirst(frame) {
  return frame.kneeSpeed > LIMITS.kneesStraightening && frame.trunkSpeed > LIMITS.chestStillDropping;
}

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

function getBias(difference) {
  if (difference > LIMITS.biasRange) {
    return "hip-biased";
  }
  if (difference < -LIMITS.biasRange) {
    return "knee-biased";
  }
  return "balanced";
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (secs < 10) {
    return minutes + ":0" + secs;
  }
  return minutes + ":" + secs;
}

function makeTips(frames, lift) {
  const tips = [];

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

function findReps(frames) {
  let reps = [];
  let isDown = false;
  let bottom = 0;

  for (let i = 0; i < frames.length; i++) {
    let knee = frames[i].kneeAngle;

    if (isDown == false && knee < 140) {
      isDown = true;
      bottom = i;
    }

    if (isDown == true) {
      if (frames[i].hip.y > frames[bottom].hip.y) {
        bottom = i;
      }
      if (knee > 160) {
        reps.push(bottom);
        isDown = false;
      }
    }
  }

  return reps;
}

