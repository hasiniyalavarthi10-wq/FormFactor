function distance(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function calculateAngle(a, b, c) {
  const ab = distance(a, b);
  const bc = distance(b, c);
  const ac = distance(a, c);

  let cos = (ab * ab + bc * bc - ac * ac) / (2 * ab * bc);

  if (cos > 1) {
    cos = 1;
  }
  if (cos < -1) {
    cos = -1;
  }

  return Math.acos(cos) * 180 / Math.PI;
}

function leanAngle(top, bottom) {
  const straightUp = { x: bottom.x, y: bottom.y - 100 };
  return calculateAngle(top, bottom, straightUp);
}

function thighAngle(hip, knee) {
  const sin = (hip.y - knee.y) / distance(hip, knee);
  return Math.asin(sin) * 180 / Math.PI;
}

function angleSpeed(oldAngle, newAngle, oldTime, newTime) {
  if (newTime === oldTime) {
    return 0;
  }
  return (newAngle - oldAngle) / (newTime - oldTime);
}
