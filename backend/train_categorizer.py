import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.feature_extraction import text as sktext
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score
from sklearn.preprocessing import LabelEncoder
import joblib

# --- Configuration ---
DATA_PATH = os.path.join("data", "website_classification.csv")
MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

# Optional custom stopwords file (one word per line)
CUSTOM_STOPWORDS_PATH = os.path.join("data", "custom_stopwords.txt")

# Reasonable defaults for very general terms that skew categories
DEFAULT_CUSTOM_STOPWORDS = {
    # brands/platforms
    "google", "gmail", "youtube", "facebook", "twitter", "instagram", "reddit", "amazon",
    # generic web/ux terms
    "login", "signin", "signup", "logout", "account", "profile", "privacy", "terms",
    "policy", "cookies", "cookie", "subscribe", "unsubscribe", "contact", "support",
    "home", "about", "blog", "search",
    # url-ish tokens that may survive cleaning
    "www", "http", "https", "com", "net", "org", "index",
    # mail-related
    "mail", "email",
}


def load_custom_stopwords(path: str) -> set:
    words = set()
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if not w or w.startswith("#"):
                    continue
                words.add(w.lower())
    return words

def train_categorizer():
    print("Loading dataset...")
    df = pd.read_csv(DATA_PATH, index_col=0)
    df.dropna(subset=['cleaned_website_text', 'Category'], inplace=True)

    # Normalize and clean basic fields
    df['Category'] = df['Category'].astype(str).str.strip()
    df['cleaned_website_text'] = df['cleaned_website_text'].astype(str).str.strip()

    # --- THIS IS THE KEY CHANGE ---
    # We are now using the rich text from the website, not the URL.
    x_raw = df['cleaned_website_text'].astype(str).values
    # --- END KEY CHANGE ---

    

    # Check for class imbalance (good practice)
    print("Class Distribution (raw):")
    print(df['Category'].value_counts())
    print("-" * 30)

    # Ensure each class has at least 2 samples for stratified split
    class_counts = df['Category'].value_counts()
    too_small = class_counts[class_counts < 2]
    if not too_small.empty:
        print("Warning: The following categories have < 2 samples and will be excluded to enable stratified split:")
        print(too_small)
        keep_mask = ~df['Category'].isin(too_small.index)
        removed = len(df) - keep_mask.sum()
        df = df[keep_mask].reset_index(drop=True)
        x_raw = df['cleaned_website_text'].astype(str).values
        print(f"Removed {removed} rows with too-small classes. New distribution:")
        print(df['Category'].value_counts())
        print("-" * 30)

    # Encode text labels to integers
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(df['Category'].values)

    # Split the data
    # Try a stratified split first; if it fails, fall back to non-stratified
    try:
        X_train, X_test, y_train, y_test = train_test_split(
            x_raw, y, test_size=0.2, random_state=42, stratify=y
        )
    except ValueError as e:
        print("Stratified split failed:", str(e))
        print("Falling back to non-stratified train/test split. Consider adding more samples per category.")
        X_train, X_test, y_train, y_test = train_test_split(
            x_raw, y, test_size=0.2, random_state=42, stratify=None
        )

    # Build stopword list: sklearn english + custom words (file + defaults)
    custom_sw = load_custom_stopwords(CUSTOM_STOPWORDS_PATH)
    stop_words = list(sktext.ENGLISH_STOP_WORDS.union(DEFAULT_CUSTOM_STOPWORDS).union(custom_sw))

    # Create a simple, powerful pipeline: Vectorizer -> Classifier
    # We use word-level analysis now because we have full sentences.
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),  # Look at single words and two-word phrases
        max_features=20000,
        sublinear_tf=True,   # Smooths term frequencies
        stop_words=stop_words,
        max_df=0.85          # Drop terms appearing in >85% of docs (too general)
    )
    
    # A simple Logistic Regression model is a great baseline.
    # Increased max_iter for convergence.
    classifier = LogisticRegression(
        max_iter=2000, 
        random_state=42, 
        class_weight='balanced', # Helps with class imbalance
        C=0.5 # A little regularization
    )

    print("Vectorizing text data and training model...")
    print(f"Using {len(stop_words)} stopwords (incl. custom). max_df=0.85")
    # Fit the vectorizer on the training data
    x_train_vec = vectorizer.fit_transform(X_train)

    # Train the classifier
    classifier.fit(x_train_vec, y_train)

    # Evaluate the model
    print("Evaluating model performance...")
    x_test_vec = vectorizer.transform(X_test)
    y_pred = classifier.predict(x_test_vec)

    accuracy = accuracy_score(y_test, y_pred)
    print(f"\n--- Model Accuracy: {accuracy:.4f} ---")
    
    # Print a detailed report
    print("\nClassification Report:")
    # Use original text labels for the report and ensure labels align
    target_names = label_encoder.classes_
    all_labels = np.arange(len(target_names))
    print(classification_report(y_test, y_pred, labels=all_labels, target_names=target_names, zero_division=0))

    # Save the simplified model artifacts
    print("Saving model artifacts...")
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, "categorizer_vectorizer.pkl"))
    joblib.dump(classifier, os.path.join(MODELS_DIR, "categorizer.pkl")) # Simplified name
    joblib.dump(label_encoder, os.path.join(MODELS_DIR, "categorizer_label_encoder.pkl"))
    
    print("Training complete and artifacts saved.")

if __name__ == "__main__":
    train_categorizer()