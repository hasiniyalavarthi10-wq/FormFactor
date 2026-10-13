# Validation: FormFactor vs. published measurements

**Date:** 2026-10-13

**What we tested:** FormFactor's own pose detection (MediaPipe Pose Landmarker, full model) and angle
code (`trunkLeanAngle`, `shinAngle`, `movementBias`) on the three example squat photos in
**Figure 5 (trunk–tibia angle)** of Straub & Powers (2024), *A Biomechanical Review of the Squat Exercise*.
The paper's angles were measured by the authors and printed on the photos.

| Photo | Paper trunk / shin | FormFactor trunk / shin | Paper trunk − shin | FormFactor trunk − shin | Paper category | FormFactor category |
|---|---|---|---|---|---|---|
| A | 41° / 23° | 38° / 21° | +18° | +17° | Hip-biased | Hip-biased ✅ |
| B | 22° / 38° | 20° / 39° | −16° | −19° | Knee-biased | Knee-biased ✅ |
| C | 31° / 22° | 27° / 20° | +9° | +7° | Balanced | Balanced ✅ |

**Result:** all 3 categories matched. Individual angles were within 1°–4° of the paper's.
The trunk angle came out 2°–4° lower each time, probably because MediaPipe places the shoulder and
hip points at the joint centers, which can be slightly different from where the authors drew their lines.

**Limits of this test:** only 3 still photos of one person, from one paper. This is a check that the
math and convention match the research, not a full accuracy study. (The figure is not included in
this repository; see the paper.)
