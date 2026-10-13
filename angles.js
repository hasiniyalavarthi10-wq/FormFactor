// FormFactor - angles.js
// MY CODE: turns joint positions into angles.
//
// Every point is an object like { x: 120, y: 340 }, measured in pixels.
// Remember: in images, x grows to the RIGHT and y grows DOWNWARD.
//
// (Stubs and comments provided by Claude Code. The code inside each function is mine.)


// Returns the angle (in degrees) at point b, between the line b->a and the line b->c.
// Inputs:  a, b, c are points { x, y }. b is the joint in the middle.
// Output:  a number from 0 to 180. Straight line = 180. Right angle = 90.
// Example: calculateAngle(hip, knee, ankle) is the knee angle.
function calculateAngle(a, b, c) {
  // TODO: my implementation
}


// Returns how far the trunk (hip -> shoulder line) leans forward from straight up, in degrees.
// Inputs:  shoulder, hip are points { x, y }
// Output:  0 = standing straight up, 90 = trunk flat (horizontal)
// (Concept explained in the next step.)
function trunkLeanAngle(shoulder, hip) {
  // TODO: my implementation
}


// Returns the knee angle in degrees.
// Inputs:  hip, knee, ankle are points { x, y }
// Output:  about 180 standing tall, smaller as the knee bends
// (Concept explained in a later step.)
function kneeAngle(hip, knee, ankle) {
  // TODO: my implementation
}


// Returns how fast an angle is changing, in degrees per second.
// Inputs:  previousAngle, currentAngle in degrees; previousTime, currentTime in seconds
// Output:  positive = angle getting bigger, negative = angle getting smaller
// (Concept explained in a later step.)
function angularVelocity(previousAngle, currentAngle, previousTime, currentTime) {
  // TODO: my implementation
}
