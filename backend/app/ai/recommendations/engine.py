"""Deterministic, explainable fashion rules; these are not learned accuracy scores."""

from app.schemas.domain import BodyProfile, Product, Size, StyleScore


def recommend_size(product: Product, profile: BodyProfile) -> tuple[Size, int, int]:
    if product.silhouette == "bottom":
        # Pose landmarks do not recover waist circumference. The catalogue's
        # generic MVP chart cannot support confident trouser/jean calibration.
        size = "M" if "M" in product.sizes else product.sizes[len(product.sizes) // 2]
        return size, 35, 60
    if profile.chestCm is None or profile.source == "demo":
        size = "M" if "M" in product.sizes else product.sizes[len(product.sizes) // 2]
        return size, 45, 65
    ease = 8 if product.silhouette == "top" else 5
    target = profile.chestCm + ease
    size = min(product.sizes, key=lambda value: abs(product.measurements[value].chest - target))
    gap = abs(product.measurements[size].chest - target)
    # Confidence deliberately caps below tailor-level certainty.
    confidence = int(min(82, profile.confidence * 100) * max(0.5, 1 - gap / 60))
    fit = round(max(40, min(94, 94 - gap * 2)))
    return size, confidence, fit


def score(product: Product, color: str, occasion: str, profile: BodyProfile) -> StyleScore:
    size, confidence, fit = recommend_size(product, profile)
    structured = product.category in ("Blazers", "Jackets", "Shirts")
    style = round(
        min(
            95,
            78
            + (8 if structured and profile.shoulderRatio < 1.2 else 3)
            + (5 if "relaxed" in product.description.lower() else 2),
        )
    )
    occasion_score = 94 if occasion in product.occasions else 66
    neutral = {"Navy", "Black", "White", "Charcoal", "Beige", "Olive"}
    palette = [c.name for c in product.colors]
    preferred = sorted(palette, key=lambda c: (c not in neutral, c))
    color_score = 91 if color in neutral else 84
    if occasion in ("Wedding", "Festival", "Party") and color in ("Maroon", "Teal", "Rose", "Emerald"):
        color_score = 94
    overall = round(style * 0.3 + color_score * 0.25 + fit * 0.25 + occasion_score * 0.2)
    calibration = (
        "Based on your supplied height and visible body proportions"
        if profile.chestCm
        else ("Without height calibration, the size is a starting point based on the brand chart")
    )
    if product.silhouette == "bottom":
        calibration = (
            "Bottom sizing is a low-confidence starting point; confirm your waist with the store chart"
        )
    explanation = (
        f"{product.name}'s {product.category.lower()} cut offers a "
        f"{'structured' if structured else 'relaxed'} silhouette. "
        f"{color or palette[0]} is {'a versatile neutral' if color in neutral else 'a colorful accent'} "
        f"for {occasion.lower()} styling. {calibration}. "
        "These scores express catalogue rules and preferences, not attractiveness or measured accuracy."
    )
    return StyleScore(
        style=style,
        color=color_score,
        fit=fit,
        occasion=occasion_score,
        overall=overall,
        explanation=explanation,
        recommendedSize=size,
        sizeConfidence=confidence,
        colors=preferred[:3],
    )
