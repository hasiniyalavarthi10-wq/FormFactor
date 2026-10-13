// FormFactor - angles.js
// Turns joint positions into angles.
//
// Every point is an object like { x: 120, y: 340 }, measured in pixels.
// Remember: in images, x grows to the RIGHT and y grows DOWNWARD.
//
// (Written by Claude Code at my request. I plan to review and revise it.)


// Returns the straight-line distance between two points (Pythagorean theorem)
function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}


// Returns the angle (in degrees) at point b, between the line b->a and the line b->c.
// Uses the Law of Cosines: cos(B) = (ab² + bc² - ac²) / (2 · ab · bc)
// Inputs:  a, b, c are points { x, y }. b is the joint in the middle.
// Output:  a number from 0 to 180. Straight line = 180. Right angle = 90.
function calculateAngle(a, b, c) {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);

  // If two points are on top of each other, there is no angle to measure
  if (ab === 0 || bc === 0) {
    return NaN;
  }

  let cosine = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);

  // Tiny rounding errors can make this 1.0000001, and Math.acos only accepts -1 to 1
  if (cosine > 1) {
    cosine = 1;
  }
  if (cosine < -1) {
    cosine = -1;
  }

  // Math.acos gives radians; multiply by 180 / PI to get degrees
  return Math.acos(cosine) * 180 / Math.PI;
}


// Returns how far the trunk (hip -> shoulder line) leans forward from straight up, in degrees.
// Trick: make a pretend point straight ABOVE the hip, then measure the angle at the hip
// between the shoulder and that point.
// Inputs:  shoulder, hip are points { x, y }
// Output:  0 = standing straight up, 90 = trunk flat (horizontal)
function trunkLeanAngle(shoulder, hip) {
  const pointAboveHip = { x: hip.x, y: hip.y - 100 };  // minus, because y grows downward
  return calculateAngle(shoulder, hip, pointAboveHip);
}


// Returns how far the shin (ankle -> knee line) leans forward from straight up, in degrees.
// Same trick and same convention as trunkLeanAngle, so the two can be compared.
// Inputs:  knee, ankle are points { x, y }
// Output:  0 = shin straight up, bigger = knee further forward over the toes
function shinAngle(knee, ankle) {
  const pointAboveAnkle = { x: ankle.x, y: ankle.y - 100 };
  return calculateAngle(knee, ankle, pointAboveAnkle);
}


// Returns the knee angle in degrees (the angle at the knee between hip and ankle).
// Inputs:  hip, knee, ankle are points { x, y }
// Output:  about 180 standing tall, smaller as the knee bends
function kneeAngle(hip, knee, ankle) {
  return calculateAngle(hip, knee, ankle);
}


// Returns how fast an angle is changing, in degrees per second.
// Formula: angular velocity = change in angle / change in time = Δθ / Δt
// Inputs:  previousAngle, currentAngle in degrees; previousTime, currentTime in seconds
// Output:  positive = angle getting bigger, negative = angle getting smaller
function angularVelocity(previousAngle, currentAngle, previousTime, currentTime) {
  const timePassed = currentTime - previousTime;
  if (timePassed === 0) {
    return 0;  // can't divide by zero
  }
  return (currentAngle - previousAngle) / timePassed;
}
