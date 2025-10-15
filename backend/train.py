# script to train model & save artifacts
# train.py
"""
Train a simple URL-based model from backend/data/TestingHistory.csv
Produces:
 - models/vectorizer.pkl
 - models/classifier.pkl   (logistic classifier for high-interest)
 - models/regressor.pkl    (ridge regressor for frecency)
"""

import os
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.metrics import classification_report, root_mean_squared_error, r2_score
import joblib

# Config
DATA_PATH = os.path.join("data", "TestingHistory.csv")
MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

# Threshold to binarize frecency for classification (tweakable)
FRECENCY_THRESHOLD = None  # if None, we'll pick median from data

def load_data(path=DATA_PATH):
    # Expected CSV columns: url, first_visit, last_visit, click_count, frecency
    df = pd.read_csv(path)
    # Ensure 'url' and 'frecency' exist
    if "url" not in df.columns or "frecency" not in df.columns:
        raise ValueError("CSV must contain 'url' and 'frecency' columns.")
    # Drop rows with missing URL
    df = df.dropna(subset=["url"])
    # Convert frecency to numeric
    df["frecency"] = pd.to_numeric(df["frecency"], errors="coerce").fillna(0.0)
    return df

def basic_url_clean(urls):
    # Basic normalization: lowercase and replace common separators with spaces
    out = []
    for u in urls:
        s = str(u).lower()
        # remove protocol
        s = s.replace("http://", "").replace("https://", "")
        # replace separators with spaces
        for ch in ["/", "?", "&", "=", "-", "_", ".", "%20"]:
            s = s.replace(ch, " ")
        out.append(s)
    return out

def train():
    df = load_data()
    X_raw = basic_url_clean(df["url"].astype(str).values)
    y_reg = df["frecency"].values

    # determine threshold if not provided
    global FRECENCY_THRESHOLD
    if FRECENCY_THRESHOLD is None:
        FRECENCY_THRESHOLD = float(np.median(y_reg))
        print(f"Using median frecency as threshold: {FRECENCY_THRESHOLD:.2f}")

    # binarize label
    y_clf = (y_reg >= FRECENCY_THRESHOLD).astype(int)

    # train/test split
    X_train, X_test, yclf_train, yclf_test, yreg_train, yreg_test = train_test_split(
        X_raw, y_clf, y_reg, test_size=0.2, random_state=42, stratify=y_clf
    )

    # vectorizer: TF-IDF on URL tokens (character n-grams or word tokens both fine)
    vectorizer = TfidfVectorizer(ngram_range=(1,2), max_features=20000)

    # Fit vectorizer on training URLs
    Xtr = vectorizer.fit_transform(X_train)
    Xte = vectorizer.transform(X_test)

    # Classifier pipeline (logistic)
    clf = LogisticRegression(max_iter=1000)
    clf.fit(Xtr, yclf_train)
    ypred_clf = clf.predict(Xte)

    print("=== Classification report (high-interest vs low) ===")
    print(classification_report(yclf_test, ypred_clf, digits=4))

    # Regressor pipeline (predict frecency)
    reg = Ridge(alpha=1.0)
    reg.fit(Xtr, yreg_train)
    ypred_reg = reg.predict(Xte)
    print("=== Regression metrics (predicting frecency) ===")
    print(f"RMSE: {root_mean_squared_error(yreg_test, ypred_reg):.4f}")
    print(f"R^2: {r2_score(yreg_test, ypred_reg):.4f}")

    # Save artifacts
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, "vectorizer.pkl"))
    joblib.dump(clf, os.path.join(MODELS_DIR, "classifier.pkl"))
    joblib.dump(reg, os.path.join(MODELS_DIR, "regressor.pkl"))

    print("Saved models to", MODELS_DIR)
    # Save threshold for later use
    joblib.dump({"frecency_threshold": FRECENCY_THRESHOLD}, os.path.join(MODELS_DIR, "meta.pkl"))

if __name__ == "__main__":
    train()
