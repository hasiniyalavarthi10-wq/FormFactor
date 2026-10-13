// FormFactor - risk.js
// Decides if form is safe, warning, or danger, based on the angles from angles.js.
//
// Design decisions (mine):
//   - Red (danger) only comes from the trunk angle CHANGING fast, because my research
//     says the hazard is the back angle shifting mid-lift.
//   - Trunk lean and missed squat depth are only yellow (warning), because how much
//     you lean depends on your leg length, and a shallow squat isn't dangerous.
//
// (Logic written by Claude Code at my request. The 45° value comes from my research.
//  I plan to review the logic and tune the other numbers with my own recorded lifts.)


// All the numbers the risk logic uses, in one place.
const THRESHOLDS = {
  // FROM MY RESEARCH (p.5): a safe trunk angle is 15° to 45° off vertical. Used for squats only.
  trunkLeanWarning: 45,

  // STARTING ESTIMATES, NOT FROM RESEARCH. Speeds in degrees per second.
  // TODO: my research values. Tune by recording good lifts and bad lifts and comparing.
  trunkDropWarning: 60,         // chest dropping forward this fast = warning (a normal 1-second descent is about 50)
  trunkDropDanger: 100,         // chest dropping forward this fast = danger
  kneeStraighteningSpeed: 30,   // knees straightening at least this fast = standing up
  shearTrunkSpeed: 10,          // chest still dropping this fast WHILE knees straighten = hips rising first

  // STARTING ESTIMATES: finding reps from the knee angle (degrees)
  repStartKneeAngle: 140,       // knee bends past this = a rep has started
  repEndKneeAngle: 160,         // knee straightens past this = back to standing

  // STARTING ESTIMATES: squat depth, measured as how far the hip is below the knee,
  // as a fraction of thigh length (so it works for any body size or camera distance)
  parallelDrop: -0.05,          // parallel: hip about level with the knee (small allowance)
  deepDrop: 0.15,               // deep: hip clearly below the knee

  // FROM RESEARCH (Straub & Powers, 2024): if trunk and shin angles differ by more than
  // about 10°, the squat is hip-biased or knee-biased. Within 10° it is about balanced.
  biasMargin: 10,

  // MediaPipe's confidence (0 to 1) that it can see a joint. Below this, we don't trust the frame.
  minVisibility: 0.5
};


// ======== ONE FRAME ========

// Returns true if MediaPipe could clearly see all four joints in this frame
function jointsVisible(frame) {
  return frame.shoulder.visibility > THRESHOLDS.minVisibility
      && frame.hip.visibility > THRESHOLDS.minVisibility
      && frame.knee.visibility > THRESHOLDS.minVisibility
      && frame.ankle.visibility > THRESHOLDS.minVisibility;
}

// Returns true if the knees are straightening but the chest is still dropping forward.
// This is the "hips shoot up first" / good-morning pattern that moves load onto the lower back.
function isShearPattern(frame) {
  return frame.kneeSpeed > THRESHOLDS.kneeStraighteningSpeed
      && frame.trunkSpeed > THRESHOLDS.shearTrunkSpeed;
}

// Returns the risk level for ONE frame: "safe", "warning", "danger", or "unknown".
// frame has: time, kneeAngle, hipAngle, trunkLean, trunkSpeed, kneeSpeed (and the joints)
// trunkSpeed is positive when the chest is moving forward/down.
// lift is "squat" or "deadlift".
function frameRiskLevel(frame, lift) {
  if (!jointsVisible(frame)) {
    return "unknown";
  }
  if (frame.trunkSpeed > THRESHOLDS.trunkDropDanger) {
    return "danger";
  }
  if (frame.trunkSpeed > THRESHOLDS.trunkDropWarning) {
    return "warning";
  }
  if (isShearPattern(frame)) {
    return "warning";
  }
  if (lift === "squat" && frame.trunkLean > THRESHOLDS.trunkLeanWarning) {
    return "warning";
  }
  return "safe";
}


// ======== SQUAT REPS AND DEPTH ========

// Finds the bottom of each squat rep.
// A rep starts when the knee bends past repStartKneeAngle and ends when it straightens
// past repEndKneeAngle. The bottom is the frame where the hip is lowest (biggest y).
// Output: a list of frame numbers, one per rep. Example: [14, 52, 90] means 3 reps.
function findRepBottoms(frames) {
  const bottoms = [];
  let inRep = false;
  let lowest = 0;

  for (let i = 0; i < frames.length; i++) {
    const angle = frames[i].kneeAngle;

    if (!inRep && angle < THRESHOLDS.repStartKneeAngle) {
      inRep = true;
      lowest = i;
    }

    if (inRep) {
      if (frames[i].hip.y > frames[lowest].hip.y) {
        lowest = i;
      }
      if (angle > THRESHOLDS.repEndKneeAngle) {
        bottoms.push(lowest);
        inRep = false;
      }
    }
  }

  // Count a rep that was still going when recording stopped
  if (inRep) {
    bottoms.push(lowest);
  }
  return bottoms;
}

// Returns true if the hip got low enough at the bottom of a rep.
// depthGoal is "parallel" or "deep".
function reachedDepth(bottomFrame, depthGoal) {
  const thighLength = distance(bottomFrame.hip, bottomFrame.knee);
  const hipBelowKnee = bottomFrame.hip.y - bottomFrame.knee.y;  // positive = hip lower (y grows downward)
  const drop = hipBelowKnee / thighLength;

  if (depthGoal === "deep") {
    return drop >= THRESHOLDS.deepDrop;
  }
  return drop >= THRESHOLDS.parallelDrop;
}


// ======== WHOLE SET ========

// Turns a level into a number so levels can be compared (bigger = worse)
function levelRank(level) {
  if (level === "danger") {
    return 2;
  }
  if (level === "warning") {
    return 1;
  }
  return 0;
}

// Returns the worst level of any frame: this is the lower-back load estimate
function lowerBackLoad(frames) {
  let worst = "safe";
  for (let i = 0; i < frames.length; i++) {
    if (levelRank(frames[i].level) > levelRank(worst)) {
      worst = frames[i].level;
    }
  }
  return worst;
}

// Returns the overall result for the set: worst frame, and a warning if any rep missed depth
function overallLevel(frames, repResults) {
  let overall = lowerBackLoad(frames);
  for (let i = 0; i < repResults.length; i++) {
    if (repResults[i].reached === false && overall === "safe") {
      overall = "warning";
    }
  }
  return overall;
}

// Returns the frame number of the worst moment: worst level first, then fastest chest drop.
// Returns -1 if every frame was safe.
function worstFrameIndex(frames) {
  let worst = -1;
  for (let i = 0; i < frames.length; i++) {
    if (levelRank(frames[i].level) === 0) {
      continue;
    }
    if (worst === -1) {
      worst = i;
    } else if (levelRank(frames[i].level) > levelRank(frames[worst].level)) {
      worst = i;
    } else if (levelRank(frames[i].level) === levelRank(frames[worst].level)
            && frames[i].trunkSpeed > frames[worst].trunkSpeed) {
      worst = i;
    }
  }
  return worst;
}

// Returns the signed difference: trunk angle minus shin angle, in degrees.
// Positive = trunk leans more than the shin. Negative = shin leans more than the trunk.
function trunkShinDifference(frame) {
  return frame.trunkLean - frame.shinAngle;
}

// Returns "hip-biased", "balanced", or "knee-biased" for a trunk-minus-shin difference.
// Categories from Straub & Powers (2024), A Biomechanical Review of the Squat Exercise.
// This describes hip vs. knee demand. It is NOT an injury risk or a form failure.
function movementBias(difference) {
  if (difference > THRESHOLDS.biasMargin) {
    return "hip-biased";
  }
  if (difference < -THRESHOLDS.biasMargin) {
    return "knee-biased";
  }
  return "balanced";
}

// Returns the average trunk-minus-shin difference at the bottom of the squat reps
// (or NaN if there are no reps)
function averageBottomDifference(frames, bottoms) {
  if (bottoms.length === 0) {
    return NaN;
  }
  let total = 0;
  for (let i = 0; i < bottoms.length; i++) {
    total = total + trunkShinDifference(frames[bottoms[i]]);
  }
  return total / bottoms.length;
}

// Turns seconds into a clock time like "0:03"
function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const wholeSeconds = Math.floor(seconds % 60);
  if (wholeSeconds < 10) {
    return minutes + ":0" + wholeSeconds;
  }
  return minutes + ":" + wholeSeconds;
}

// Returns a list of plain-English messages about the set
function buildFlags(frames, lift, depthGoal, repResults) {
  const flags = [];

  // 1. Fastest forward chest drop
  let fastest = -1;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].level === "unknown") {
      continue;
    }
    if (fastest === -1 || frames[i].trunkSpeed > frames[fastest].trunkSpeed) {
      fastest = i;
    }
  }
  if (fastest !== -1 && frames[fastest].trunkSpeed > THRESHOLDS.trunkDropWarning) {
    flags.push("Trunk leaned forward quickly at " + formatTime(frames[fastest].time) +
      " (about " + Math.round(frames[fastest].trunkSpeed) + "° per second), which increases load on the lower back.");
  }

  // 2. Shear force warning: hips rising before the chest
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].level !== "unknown" && isShearPattern(frames[i])) {
      flags.push("Shear force warning at " + formatTime(frames[i].time) +
        ": your knees straightened while your chest was still dropping forward (hips rose first). " +
        "This shifts load from your legs to your lower back.");
      break;  // only report the first time
    }
  }

  // 3. Most forward lean (squats only)
  if (lift === "squat") {
    let mostLean = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].level === "unknown") {
        continue;
      }
      if (mostLean === -1 || frames[i].trunkLean > frames[mostLean].trunkLean) {
        mostLean = i;
      }
    }
    if (mostLean !== -1 && frames[mostLean].trunkLean > THRESHOLDS.trunkLeanWarning) {
      flags.push("At " + formatTime(frames[mostLean].time) + " your trunk leaned about " +
        Math.round(frames[mostLean].trunkLean) + "° forward (more than " + THRESHOLDS.trunkLeanWarning + "°). " +
        "Some lean is normal and depends on your leg length, but more lean puts more load on the lower back.");
    }
  }

  // 4. Reps that missed the depth goal (one summary line; each rep is listed under Depth check)
  let missedCount = 0;
  for (let i = 0; i < repResults.length; i++) {
    if (repResults[i].reached === false) {
      missedCount = missedCount + 1;
    }
  }
  if (missedCount > 0) {
    flags.push(missedCount + " of " + repResults.length + " reps didn't reach your " + depthGoal +
      " depth goal (see Depth check below). This isn't a back-safety problem, but you get less out of each rep.");
  }

  // 5. Frames where the body was hard to see
  let unknownCount = 0;
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].level === "unknown") {
      unknownCount = unknownCount + 1;
    }
  }
  if (unknownCount > frames.length * 0.3) {
    flags.push("Your body was hard to see in " + Math.round(100 * unknownCount / frames.length) +
      "% of frames, so these results are less reliable. Try better lighting and keep your whole body in view.");
  }

  if (flags.length === 0) {
    flags.push("No warning signs found in this set. Nice work!");
  }
  return flags;
}
