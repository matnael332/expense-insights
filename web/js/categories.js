/* Merchant normalization and keyword-based categories (Hebrew + English).
 * Classic script: works in the browser (window.EI) and in Node (require). */
(function (root) {
  "use strict";

  const CATEGORIES = [
    { id: "groceries", label: "מכולת וסופר", keywords: ["שופרסל", "רמי לוי", "יינות ביתן", "ויקטורי", "מגה", "אושר עד", "טיב טעם", "סופר", "מכולת", "מאפיית", "מאפיה", "supermarket", "grocery", "bakery"] },
    { id: "dining", label: "מסעדות וקפה", keywords: ["מסעדת", "מסעדה", "קפה", "ארומה", "מקדונלד", "פיצה", "בורגר", "וולט", "תן ביס", "קפה גרג", "restaurant", "cafe", "coffee", "pizza", "burger", "wolt"] },
    { id: "transport", label: "תחבורה ודלק", keywords: ["דלק", "פז", "סונול", "דור אלון", "רב קו", "רכבת ישראל", "גט טקסי", "יאנגו", "חניה", "פנגו", "fuel", "gas station", "train", "taxi", "parking"] },
    { id: "utilities", label: "חשבונות ותקשורת", keywords: ["חברת החשמל", "חשמל", "מקורות", "בזק", "פרטנר", "סלקום", "הוט", "אינטרנט", "ארנונה", "electric", "internet", "water", "phone"] },
    { id: "entertainment", label: "בילויים ומנויים", keywords: ["נטפליקס", "ספוטיפיי", "קולנוע", "סינמה סיטי", "יס פלנט", "דיסני", "netflix", "spotify", "cinema", "disney"] },
    { id: "health", label: "בריאות", keywords: ["סופר פארם", "פארם", "מכבי", "כללית", "מאוחדת", "לאומית שירותי", "רופא", "מרפאה", "pharmacy", "clinic", "doctor", "dentist"] },
    { id: "shopping", label: "קניות", keywords: ["איקאה", "זארה", "קסטרו", "פוקס", "עלי אקספרס", "אמזון", "ksp", "ace", "amazon", "aliexpress", "ikea", "zara"] },
    { id: "housing", label: "דיור", keywords: ["שכירות", "משכנתא", "ועד בית", "rent", "mortgage"] },
    { id: "credit", label: "זיכויים והחזרים", keywords: [] },
    { id: "other", label: "אחר", keywords: [] },
  ];

  const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

  function categoryLabel(id) {
    const found = CATEGORIES.find((c) => c.id === id);
    return found ? found.label : id;
  }

  /* Lowercase, drop punctuation and standalone numbers (branch ids, store
   * numbers), collapse whitespace. "שופרסל דיל 123, תל-אביב" -> "שופרסל דיל תל אביב". */
  function normalizeMerchant(name) {
    return String(name == null ? "" : name)
      .toLowerCase()
      .replace(/[‎‏‪-‮]/g, "")
      .replace(/["'`“”׳״*#_.,()/\\:;|+\-–—]/g, " ")
      .replace(/(^|\s)\d+(?=\s|$)/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* Keywords match whole words only ("ace" must not match "space"). The
   * longest matching keyword wins, so a specific keyword ("סופר פארם") beats a
   * generic one ("סופר"). Ties go to the earlier category. */
  function categorize(normalizedName, amount, overrides) {
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, normalizedName)) {
      const chosen = overrides[normalizedName];
      if (CATEGORY_IDS.includes(chosen)) return chosen;
    }
    if (amount > 0) return "credit";
    const padded = " " + normalizedName + " ";
    let best = "other";
    let bestLength = 0;
    for (const category of CATEGORIES) {
      for (const keyword of category.keywords) {
        if (keyword.length > bestLength && padded.includes(" " + keyword + " ")) {
          best = category.id;
          bestLength = keyword.length;
        }
      }
    }
    return best;
  }

  const api = { CATEGORIES, categoryLabel, normalizeMerchant, categorize };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.EI = Object.assign(root.EI || {}, api);
})(typeof self !== "undefined" ? self : globalThis);
