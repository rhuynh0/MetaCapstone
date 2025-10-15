# script to train model & save artifacts
# train.py
"""
Train a simple URL-based model from backend/data/TestingHistory.csv
Produces:
 - models/vectorizer.pkl
 - models/classifier.pkl   (logistic classifier for high-interest)
 - models/regressor.pkl    (gradient boosting regressor for frecency)
"""

import os
import pandas as pd
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
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

    # Ensure columns exist
    if "url" not in df.columns or "frecency" not in df.columns:
        raise ValueError("CSV must contain 'url' and 'frecency' columns.")

    # Clean + fix missing data
    df = df.dropna(subset=["url"])
    df["frecency"] = pd.to_numeric(df["frecency"], errors="coerce").fillna(0.0)

    # Clip outliers (99th percentile)
    high_cutoff = df["frecency"].quantile(0.99)
    df["frecency"] = np.clip(df["frecency"], 0, high_cutoff)

    return df


def basic_url_clean(urls):
    out = []
    for u in urls:
        s = str(u).lower()
        s = s.replace("http://", "").replace("https://", "")
        for ch in ["/", "?", "&", "=", "-", "_", ".", "%20"]:
            s = s.replace(ch, " ")
        out.append(s)
    return out


def train():
    df = load_data()
    X_raw = basic_url_clean(df["url"].astype(str).values)

    # Log-transform frecency for regression stability
    y_reg = np.log1p(df["frecency"].values)

    # determine threshold if not provided
    global FRECENCY_THRESHOLD
    if FRECENCY_THRESHOLD is None:
        FRECENCY_THRESHOLD = float(np.median(y_reg))
        print(f"Using median log-frecency as threshold: {FRECENCY_THRESHOLD:.2f}")

    # binary label for classifier
    y_clf = (y_reg >= FRECENCY_THRESHOLD).astype(int)

    # train/test split
    X_train, X_test, yclf_train, yclf_test, yreg_train, yreg_test = train_test_split(
        X_raw, y_clf, y_reg, test_size=0.2, random_state=42, stratify=y_clf
    )

    # TF-IDF vectorizer (tuned for URLs)
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=20000,
        min_df=2,  # ignore extremely rare tokens
        sublinear_tf=True
    )

    Xtr = vectorizer.fit_transform(X_train)
    Xte = vectorizer.transform(X_test)

    # === CLASSIFIER ===
    clf = LogisticRegression(max_iter=1000)
    clf.fit(Xtr, yclf_train)
    ypred_clf = clf.predict(Xte)

    print("=== Classification report (high-interest vs low) ===")
    print(classification_report(yclf_test, ypred_clf, digits=4))

    # === REGRESSOR ===
    reg = GradientBoostingRegressor(
        n_estimators=250,
        max_depth=4,
        learning_rate=0.05,
        random_state=42
    )
    reg.fit(Xtr.toarray(), yreg_train)  # GradientBoosting needs dense input

    ypred_reg = reg.predict(Xte.toarray())

    # Evaluate in log-space
    rmse_log = root_mean_squared_error(yreg_test, ypred_reg)
    r2_log = r2_score(yreg_test, ypred_reg)

    # Evaluate in real-space (optional, back-transform)
    ytrue_real = np.expm1(yreg_test)
    ypred_real = np.expm1(ypred_reg)
    rmse_real = root_mean_squared_error(ytrue_real, ypred_real)
    r2_real = r2_score(ytrue_real, ypred_real)

    print("=== Regression metrics (predicting frecency) ===")
    print(f"Log-space RMSE: {rmse_log:.4f} | R²: {r2_log:.4f}")
    print(f"Real-space RMSE: {rmse_real:.4f} | R²: {r2_real:.4f}")

    # === SAVE MODELS ===
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, "vectorizer.pkl"))
    joblib.dump(clf, os.path.join(MODELS_DIR, "classifier.pkl"))
    joblib.dump(reg, os.path.join(MODELS_DIR, "regressor.pkl"))

    joblib.dump({"frecency_threshold": FRECENCY_THRESHOLD}, os.path.join(MODELS_DIR, "meta.pkl"))
    print(f"Saved all models to {MODELS_DIR}")


if __name__ == "__main__":
    train()
