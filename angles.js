// angles.js
// math for turning body points into angles
// every point looks like { x: 120, y: 340 } in pixels
// note: in pictures y goes DOWN as it gets bigger


// distance between two points (pythagorean theorem)
function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}


// angle at point b (the middle joint), in degrees
// uses the law of cosines: cos(B) = (ab² + bc² - ac²) / (2 * ab * bc)
// straight line = 180, right angle = 90
function calculateAngle(a, b, c) {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);

  let cos = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);

  // rounding can make this like 1.0000001 and acos breaks, so keep it between -1 and 1
  if (cos > 1) {
    cos = 1;
  }
  if (cos < -1) {
    cos = -1;
  }

  // acos gives radians, so change it to degrees
  return Math.acos(cos) * 180 / Math.PI;
}


// how far a body part leans forward from straight up, in degrees
// trunk: leanAngle(shoulder, hip)    shin: leanAngle(knee, ankle)
// trick: make a fake point straight above the bottom point and measure the angle there
// 0 = straight up, 90 = flat
function leanAngle(top, bottom) {
  const straightUp = { x: bottom.x, y: bottom.y - 100 };
  return calculateAngle(top, bottom, straightUp);
}


// how deep a squat is = how far the thigh points below flat, in degrees
// 0 = thigh flat (parallel), + = hip lower than knee, - = hip higher than knee
// sin(angle) = how far the hip is below the knee / thigh length
function thighAngle(hip, knee) {
  const sin = (hip.y - knee.y) / distance(hip, knee);
  return Math.asin(sin) * 180 / Math.PI;
}


// how fast an angle is changing, in degrees per second
// speed = change in angle / change in time
function angleSpeed(oldAngle, newAngle, oldTime, newTime) {
  if (newTime === oldTime) {
    return 0;  // can't divide by 0
  }
  return (newAngle - oldAngle) / (newTime - oldTime);
}
