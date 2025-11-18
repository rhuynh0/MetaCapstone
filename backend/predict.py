import os
import pandas as pd
import numpy as np
import joblib
import json
import re
from datetime import datetime, timezone
from collections import Counter
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.preprocessing import LabelEncoder, StandardScaler

# --- Class definition here to unpickle the model ---
class URLFeatureExtractor(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None): return self
    def transform(self, X):
        features = []
        for url in X:
            features.append([
                len(url),
                sum(c.isdigit() for c in url),
                sum(c.isalpha() for c in url),
                sum(not c.isalnum() and not c.isspace() for c in url),
                len(url.split())
            ])
        return np.array(features)

# --- Configuration ---
MODELS_DIR = "models"
MODEL_VERSION = "v1.2.0-dynamic-products"
USER_PSEUDONYM = "user_12345"
CATEGORY_OVERRIDES_PATH = os.path.join("data", "category_overrides.json")
CUSTOM_STOPWORDS_PATH = os.path.join("data", "custom_stopwords.txt")

# Default custom stopwords mirroring train_categorizer.py
DEFAULT_CUSTOM_STOPWORDS = {
    "google", "gmail", "youtube", "facebook", "twitter", "instagram", "reddit", "amazon",
    "login", "signin", "signup", "logout", "account", "profile", "privacy", "terms",
    "policy", "cookies", "cookie", "subscribe", "unsubscribe", "contact", "support",
    "home", "about", "blog", "search", "www", "http", "https", "com", "net", "org",
    "index", "mail", "email", "inbox",
}

def load_custom_stopwords(path: str) -> set:
    """Load custom stopwords from a text file (one word per line)."""
    words = set()
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if not w or w.startswith("#"):
                    continue
                words.add(w.lower())
    return words

# --- Helper Functions ---
def basic_url_clean(urls):
    cleaned_urls = []
    for url in urls:
        s = str(url).lower().replace("http://", "").replace("https://", "")
        for char in ["/", "?", "&", "=", "-", "_", ".", "%20", "+"]:
            s = s.replace(char, " ")
        cleaned_urls.append(s)
    return cleaned_urls

def load_category_overrides(path):
    """Load a mapping of substring -> category label from JSON, if present."""
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Normalize keys and values to lowercase for matching, but keep original value form too
                cleaned = {}
                for k, v in data.items():
                    if isinstance(k, str) and isinstance(v, str):
                        cleaned[k.lower()] = v
                return cleaned
    except Exception as e:
        print(f"Warning: failed to load category_overrides.json: {e}")
    return {}

def derive_label_keywords(labels):
    """Derive simple keyword tokens from label names for substring matching.
    Splits on non-letters and keeps tokens with length >= 4 to reduce noise.
    Filters out generic tokens that would cause over-eager overrides.
    Returns dict: label -> set(tokens)."""
    generic = {"services", "online", "social", "networking", "messaging", "corporate"}
    out = {}
    for lab in labels:
        s = re.sub(r"[^a-zA-Z]+", " ", str(lab).lower()).strip()
        toks = {t for t in s.split() if len(t) >= 4 and t not in generic}
        out[lab] = toks
    return out

def load_model(path):
    try:
        return joblib.load(path)
    except FileNotFoundError:
        print(f"Error: Model file not found at {path}")
        return None

def extract_keywords_with_counts(url_texts, top_n=15, custom_stopwords=None):
    """
    Extracts common keywords and returns them with their counts.
    Returns a list of tuples: [('keyword1', count1), ('keyword2', count2), ...]
    """
    stop_words = {'com', 'www', 'net', 'org', 'http', 'https', 'html', 'en', 'inbox'}
    if custom_stopwords:
        stop_words = stop_words.union(custom_stopwords)
    all_words = ' '.join(url_texts).split()
    filtered_words = [word for word in all_words if word not in stop_words and len(word) > 2]
    if not filtered_words:
        return []
    return Counter(filtered_words).most_common(top_n)

# --- Main Prediction Logic ---
def generate_interest_profile(urls: list = None):
    """
    Generate interest profile. A list of URL strings must be provided via the
    `urls` parameter. This function no longer falls back to a default
    filesystem CSV path — the caller (for example the FastAPI endpoint) must
    pass the URLs (e.g. from an uploaded CSV) to ensure predictions are made
    from the intended user data.
    """
    print("Loading all models...")
    # Load all necessary model artifacts
    regressor = load_model(os.path.join(MODELS_DIR, "regressor.pkl"))
    reg_vectorizer = load_model(os.path.join(MODELS_DIR, "vectorizer.pkl"))
    categorizer = load_model(os.path.join(MODELS_DIR, "categorizer.pkl"))
    cat_vectorizer = load_model(os.path.join(MODELS_DIR, "categorizer_vectorizer.pkl"))
    label_encoder = load_model(os.path.join(MODELS_DIR, "categorizer_label_encoder.pkl"))
    
    model_suite = [regressor, reg_vectorizer, categorizer, cat_vectorizer, label_encoder]
    if not all(model_suite):
        print("A required model is missing. Please run train scripts. Aborting.")
        return

    # Require caller to provide URLs. Do not use a default CSV path here to
    # avoid accidental use of stale or developer-local data.
    if urls is None:
        raise ValueError("No URLs provided. The prediction endpoint requires an uploaded CSV or a 'urls' list in the request.")
    print(f"Using {len(urls)} URLs passed in request for prediction.")

    cleaned_urls_for_cat = basic_url_clean(urls)

    # Load rule-based overrides and derived label keywords
    overrides_map = load_category_overrides(CATEGORY_OVERRIDES_PATH)  # substring -> category
    label_keywords = derive_label_keywords(label_encoder.classes_)
    
    # Load custom stopwords for filtering keywords in products
    custom_sw_file = load_custom_stopwords(CUSTOM_STOPWORDS_PATH)
    from sklearn.feature_extraction import text as sktext
    all_stopwords = sktext.ENGLISH_STOP_WORDS.union(DEFAULT_CUSTOM_STOPWORDS).union(custom_sw_file)

    # Precompute potential overrides per URL
    rule_overrides = [None] * len(cleaned_urls_for_cat)
    for i, s in enumerate(cleaned_urls_for_cat):
        low = s.lower()
        chosen = None

        # 1) Explicit substring -> category overrides (highest precedence)
        for sub, cat in overrides_map.items():
            if sub and sub in low:
                chosen = cat
                break

        # 2) If not chosen, check if any label keyword appears directly
        if chosen is None:
            best_match = (0, None)  # (token_length, category)
            for cat, toks in label_keywords.items():
                for tok in toks:
                    if tok in low and len(tok) > best_match[0]:
                        best_match = (len(tok), cat)
            if best_match[1] is not None:
                chosen = best_match[1]

        rule_overrides[i] = chosen

    # Predict categories
    x_cat = cat_vectorizer.transform(cleaned_urls_for_cat)
    predicted_categories_encoded = categorizer.predict(x_cat)
    predicted_categories = label_encoder.inverse_transform(predicted_categories_encoded)
    # Apply rule-based overrides where available
    final_categories = [rule_overrides[i] or predicted_categories[i] for i in range(len(predicted_categories))]

    # Predict frecency
    x_reg = reg_vectorizer.transform(cleaned_urls_for_cat)
    predicted_frecency = regressor.predict(x_reg)
    predicted_frecency = np.maximum(0, predicted_frecency)

    print("Aggregating results...")
    category_data = {}
    for i, category in enumerate(final_categories):
        category_data.setdefault(category, {"scores": [], "urls": []})
        category_data[category]["scores"].append(predicted_frecency[i])
        category_data[category]["urls"].append(cleaned_urls_for_cat[i])

    total_frecency_sum = sum(sum(data["scores"]) for data in category_data.values()) or 1
    output_categories = []

    for category, data in category_data.items():
        score_sum = sum(data["scores"])
        category_likelihood = score_sum / total_frecency_sum
        
        # --- DYNAMIC PRODUCT GENERATION LOGIC ---
        keywords_with_counts = extract_keywords_with_counts(data["urls"], custom_stopwords=all_stopwords)
        products = []
        
        if keywords_with_counts:
            top_keyword_count = keywords_with_counts[0][1]
            # Sum of counts for keywords that will be included, for normalization
            significant_counts_total = sum(count for _, count in keywords_with_counts 
                                           if count > 1 and count >= top_keyword_count * 0.1) or 1

            for keyword, count in keywords_with_counts:
                # Significance filter
                if count > 1 and count >= top_keyword_count * 0.1:
                    # Likelihood based on this keyword's share of significant activity
                    product_likelihood = category_likelihood * (count / significant_counts_total)
                    products.append({
                        "name": keyword.capitalize(),
                        "likelihood": round(product_likelihood, 4)
                    })
                
                # Cap the number of products to keep the list clean
                if len(products) >= 7:
                    break
        # --- END DYNAMIC LOGIC ---

        # Use the names of the generated products for the explanation
        explanation_keywords = [p["name"].lower() for p in products[:2]]
        
        output_categories.append({
            "name": category,
            "likelihood": round(category_likelihood, 2),
            "products": products,
            "explanation": [f"recent activity related to: {kw}" for kw in explanation_keywords]
        })

    output_categories.sort(key=lambda x: x["likelihood"], reverse=True)
    
    final_output = {
        "meta": {"user_pseudonym": USER_PSEUDONYM, "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"), "model_version": MODEL_VERSION},
        "categories": output_categories
    }
    
    print("\n--- User Interest Profile ---")
    print(json.dumps(final_output, indent=2))
    print("---------------------------\n")
    
    return final_output

if __name__ == "__main__":
    print("This script exposes generate_interest_profile(urls). Run via the FastAPI app or call the function with a list of URLs.")

