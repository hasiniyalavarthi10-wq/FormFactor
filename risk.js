// FormFactor - risk.js
// MY CODE: decides if form is safe, warning, or danger, based on the angles.
//
// (Stubs and comments provided by Claude Code. The threshold values and the
//  logic inside each function are mine.)


// All the numbers my risk logic uses, in one place.
// TODO: my research values (these zeros are placeholders, not real values)
const THRESHOLDS = {
  trunkLeanWarning: 0,   // degrees of forward lean that starts a warning
  trunkLeanDanger: 0     // degrees of forward lean that counts as danger
  // (more thresholds get added in a later step, like the shear-force warning)
};


// Returns the risk level for ONE frame: "safe", "warning", or "danger".
// Inputs:
//   frame - one recorded frame. It has:
//     frame.time        seconds since recording started
//     frame.kneeAngle   degrees (from my kneeAngle)
//     frame.hipAngle    degrees (from my calculateAngle)
//     frame.trunkLean   degrees (from my trunkLeanAngle)
//     frame.trunkSpeed  degrees per second (from my angularVelocity)
//     frame.kneeSpeed   degrees per second (from my angularVelocity)
//   lift - "squat" or "deadlift"
// Output: the text "safe", "warning", or "danger"
// (Concept explained after angles.js is finished.)
function frameRiskLevel(frame, lift) {
  // TODO: my implementation
}
