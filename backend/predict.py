import os
import pandas as pd
import numpy as np
import joblib
import json
from datetime import datetime, timezone
from collections import Counter
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.preprocessing import LabelEncoder, StandardScaler

# --- Class definition must be here to unpickle the model ---
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
HISTORY_DATA_PATH = os.path.join("data", "TestingHistory.csv")
MODEL_VERSION = "v1.2.0-dynamic-products" # Updated model version
USER_PSEUDONYM = "user_12345"

# --- Helper Functions ---
def basic_url_clean(urls):
    cleaned_urls = []
    for url in urls:
        s = str(url).lower().replace("http://", "").replace("https://", "")
        for char in ["/", "?", "&", "=", "-", "_", ".", "%20", "+"]:
            s = s.replace(char, " ")
        cleaned_urls.append(s)
    return cleaned_urls

def load_model(path):
    try:
        return joblib.load(path)
    except FileNotFoundError:
        print(f"Error: Model file not found at {path}")
        return None

def extract_keywords_with_counts(url_texts, top_n=15):
    """
    Extracts common keywords and returns them with their counts.
    Returns a list of tuples: [('keyword1', count1), ('keyword2', count2), ...]
    """
    stop_words = {'com', 'www', 'net', 'org', 'http', 'https', 'html', 'en'}
    all_words = ' '.join(url_texts).split()
    filtered_words = [word for word in all_words if word not in stop_words and len(word) > 2]
    if not filtered_words:
        return []
    return Counter(filtered_words).most_common(top_n)

# --- Main Prediction Logic ---
def generate_interest_profile():
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

    print(f"Loading user history from {HISTORY_DATA_PATH}...")
    try:
        history_df = pd.read_csv(HISTORY_DATA_PATH)
        history_df.dropna(subset=["url"], inplace=True)
    except FileNotFoundError:
        print(f"Error: History data not found at {HISTORY_DATA_PATH}")
        return

    urls = history_df["url"].astype(str).values
    cleaned_urls_for_cat = basic_url_clean(urls)

    # Predict categories
    X_cat = cat_vectorizer.transform(cleaned_urls_for_cat)
    predicted_categories_encoded = categorizer.predict(X_cat)
    predicted_categories = label_encoder.inverse_transform(predicted_categories_encoded)

    # Predict frecency
    X_reg = reg_vectorizer.transform(cleaned_urls_for_cat)
    predicted_frecency = regressor.predict(X_reg)
    predicted_frecency = np.maximum(0, predicted_frecency)

    print("Aggregating results...")
    category_data = {}
    for i, category in enumerate(predicted_categories):
        category_data.setdefault(category, {"scores": [], "urls": []})
        category_data[category]["scores"].append(predicted_frecency[i])
        category_data[category]["urls"].append(cleaned_urls_for_cat[i])

    total_frecency_sum = sum(sum(data["scores"]) for data in category_data.values()) or 1
    output_categories = []

    for category, data in category_data.items():
        score_sum = sum(data["scores"])
        category_likelihood = score_sum / total_frecency_sum
        
        # --- DYNAMIC PRODUCT GENERATION LOGIC ---
        keywords_with_counts = extract_keywords_with_counts(data["urls"])
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

if __name__ == "__main__":
    generate_interest_profile()

