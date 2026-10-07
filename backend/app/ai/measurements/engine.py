"""Proportion estimates from normalized landmarks, never raw photos."""

import math

from fastapi import HTTPException

from app.schemas.domain import AnalysisRequest, BodyProfile, Landmark


def distance(a: Landmark, b: Landmark) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def analyze(request: AnalysisRequest) -> BodyProfile:
    points = request.landmarks
    core = [points[i] for i in (11, 12, 23, 24)]
    if min(p.visibility for p in core) < 0.4:
        raise HTTPException(422, "Please step back slightly so your shoulders and hips are visible.")
    shoulder = distance(points[11], points[12])
    hips = distance(points[23], points[24])
    torso = (distance(points[11], points[23]) + distance(points[12], points[24])) / 2
    if min(shoulder, hips, torso) < 0.015:
        raise HTTPException(422, "Body landmarks are too close together for a reliable estimate.")
    confidence = min(0.82, sum(p.visibility for p in core) / 4 * 0.82)
    result = BodyProfile(
        shoulderRatio=round(shoulder / hips, 3),
        torsoRatio=round(torso / shoulder, 3),
        hipRatio=round(hips / shoulder, 3),
        confidence=round(confidence, 2),
        source=request.source,
    )
    # Physical units require customer-supplied height and feet/head visibility. A
    # monocular camera cannot recover absolute height from proportions alone.
    if request.heightCm is not None:
        if min(points[i].visibility for i in (0, 27, 28)) < 0.6:
            raise HTTPException(422, "Show your full body to use the height calibration.")
        span = max(points[27].y, points[28].y) - points[0].y
        if span <= 0.1:
            raise HTTPException(422, "Full body calibration is unavailable.")
        scale = request.heightCm / (span * 1.06)
        result.heightCm = request.heightCm
        result.shoulderCm = round(min(80, shoulder * scale), 1)
        result.chestCm = round(min(180, shoulder * scale * 2.2), 1)
        result.torsoCm = round(min(90, torso * scale), 1)
        result.armCm = round(
            min(120, (distance(points[11], points[13]) + distance(points[13], points[15])) * scale), 1
        )
        result.legCm = round(
            min(130, (distance(points[23], points[25]) + distance(points[25], points[27])) * scale), 1
        )
    return result
