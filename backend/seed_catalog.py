"""Reproducible synthetic retail catalogue; no remote images or customer data."""

import json
from pathlib import Path

PALETTE = {
    "Navy": "#283b57",
    "White": "#f3efe5",
    "Black": "#22232b",
    "Olive": "#718267",
    "Beige": "#c9b89e",
    "Charcoal": "#535660",
    "Maroon": "#843d54",
    "Rose": "#c87b8b",
    "Teal": "#377f82",
    "Emerald": "#346f59",
    "Indigo": "#455a82",
    "Sand": "#d4c1a1",
}
CATEGORIES = [
    (
        "T-shirts",
        "top",
        "Unisex",
        899,
        ["Casual", "College", "Travel"],
        ["Essential Cotton Tee", "Relaxed Studio Tee", "Weekend Ribbed Tee", "Everyday Oversized Tee"],
    ),
    (
        "Shirts",
        "top",
        "Men",
        1799,
        ["Office", "Interview", "Date", "Casual"],
        ["Midnight Oversized Shirt", "Oxford Button Shirt", "Linen Resort Shirt", "Clean Poplin Shirt"],
    ),
    (
        "Hoodies",
        "top",
        "Unisex",
        2199,
        ["Casual", "College", "Travel"],
        ["Cloud Fleece Hoodie", "Studio Zip Hoodie", "City Loopback Hoodie", "Weekend Oversized Hoodie"],
    ),
    (
        "Jackets",
        "top",
        "Unisex",
        3499,
        ["Casual", "Travel", "Date", "Party"],
        ["Urban Utility Jacket", "Heritage Denim Jacket", "Soft Bomber Jacket", "Lightweight Field Jacket"],
    ),
    (
        "Blazers",
        "top",
        "Men",
        4999,
        ["Office", "Interview", "Wedding", "Formal event"],
        [
            "Modern Tailored Blazer",
            "Essential Office Blazer",
            "Textured Evening Blazer",
            "Relaxed Linen Blazer",
        ],
    ),
    (
        "Dresses",
        "dress",
        "Women",
        3299,
        ["Date", "Party", "Wedding", "Formal event"],
        ["Flowing Midi Dress", "Satin Evening Dress", "Garden Wrap Dress", "Minimal Column Dress"],
    ),
    (
        "Kurtis",
        "dress",
        "Women",
        1899,
        ["Office", "Festival", "Casual", "College"],
        [
            "Everyday Straight Kurti",
            "Embroidered Cotton Kurti",
            "Heritage A-Line Kurti",
            "Printed Weekend Kurti",
        ],
    ),
    (
        "Jeans",
        "bottom",
        "Unisex",
        2499,
        ["Casual", "College", "Travel", "Date"],
        ["Classic Straight Jeans", "Relaxed Wide Leg Jeans", "Slim Stretch Jeans", "Vintage Tapered Jeans"],
    ),
    (
        "Trousers",
        "bottom",
        "Unisex",
        2799,
        ["Office", "Interview", "Formal event", "Travel"],
        [
            "Tailored Pleated Trousers",
            "Essential Chino Trousers",
            "Relaxed Linen Trousers",
            "City Straight Trousers",
        ],
    ),
    (
        "Traditional wear",
        "dress",
        "Men",
        3999,
        ["Wedding", "Festival", "Formal event"],
        [
            "Heritage Kurta Set",
            "Classic Celebration Kurta",
            "Textured Festive Kurta",
            "Silk Blend Occasion Set",
        ],
    ),
    (
        "Ethnic wear",
        "dress",
        "Women",
        4499,
        ["Wedding", "Festival", "Party"],
        [
            "Festive Anarkali Set",
            "Contemporary Ethnic Set",
            "Embroidered Celebration Set",
            "Flowing Occasion Set",
        ],
    ),
]
SIZES = ["XS", "S", "M", "L", "XL", "XXL"]


def build() -> list[dict]:
    products = []
    names = list(PALETTE)
    for index, (category, silhouette, gender, price, occasions, titles) in enumerate(CATEGORIES):
        slug = category.lower().replace(" ", "-")
        for variant, title in enumerate(titles):
            colors = [
                names[(index + variant) % len(names)],
                names[(index + variant + 3) % len(names)],
                names[(index + variant + 6) % len(names)],
            ]
            prefix = colors[0]
            product_id = f"asm-{index + 1:02d}-{variant + 1:02d}"
            asset = f"/garments/{slug}.svg"
            products.append(
                {
                    "id": product_id,
                    "sku": f"ASM-{index + 1:02d}{variant + 1:02d}",
                    "name": f"{prefix} {title}",
                    "brand": ["ATELIER", "FORM STUDIO", "URBAN THREAD", "NOVA COLLECTIVE"][variant],
                    "description": f"{title} with a relaxed, balanced silhouette, soft hand feel "
                    "and considered "
                    f"retail detailing. Demo garment; check the official size chart before purchase.",
                    "category": category,
                    "gender": gender,
                    "price": price + variant * 200,
                    "discount": [10, 0, 15, 5][variant],
                    "sizes": SIZES,
                    "colors": [{"name": name, "hex": PALETTE[name]} for name in colors],
                    "stock": 8 + (index + variant) % 17,
                    "image": asset,
                    "garmentImage": asset,
                    "frontImage": asset,
                    "backImage": asset,
                    "mask": asset,
                    "measurements": {
                        size: {
                            "chest": 88 + size_index * 8,
                            "length": (100 if silhouette == "dress" else 96 if silhouette == "bottom" else 64)
                            + size_index * 2,
                            "shoulder": 36 + size_index * 2,
                        }
                        for size_index, size in enumerate(SIZES)
                    },
                    "rack": f"{chr(65 + index)}{variant + 11}",
                    "floor": 1 if gender != "Women" else 2,
                    "section": f"{gender} Fashion",
                    "store": "Atelier Central · Bengaluru",
                    "occasions": occasions,
                    "silhouette": silhouette,
                    "featured": variant == 0,
                }
            )
    return products


if __name__ == "__main__":
    output = Path(__file__).resolve().parent.parent / "shared/catalog.json"
    output.write_text(json.dumps(build(), indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(build())} catalogue products to {output}")
