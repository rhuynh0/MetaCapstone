# train.py
"""
Train a simple URL-based model from user-uploaded CSV data.
Expected CSV format: order,id,date,time,title,url,visitCount,typedCount,transition

Produces:
- models/vectorizer.pkl
- models/classifier.pkl (logistic classifier for high-interest)
- models/regressor.pkl (gradient boosting regressor for frecency)
- models/meta.pkl
"""

import os
import pandas as pd
import numpy as np
import logging
import traceback
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, mean_squared_error, r2_score
import joblib

# Config
DATA_PATH = os.path.join("data", "BrowsingHistory.csv")  # Deprecated default; prefer CLI arg
MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

# Setup training debug logger which app will aggregate
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(MODELS_DIR, "training_debug.log"), encoding='utf-8'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("metacap.train")

# Threshold to binarize frecency for classification (tweakable)
FRECENCY_THRESHOLD = None  # if None, we'll pick median from data


def compute_frecency_from_new_format(df):
    """
    Compute a frecency-like score from the new CSV format fields.
    Formula: frecency = visitCount * 10 + typedCount * 50
    (Typed visits indicate stronger interest)
    """
    visit_count = pd.to_numeric(df.get("visitCount", 0), errors="coerce").fillna(0)
    typed_count = pd.to_numeric(df.get("typedCount", 0), errors="coerce").fillna(0)
    
    # Simple weighted frecency calculation
    frecency = visit_count * 10 + typed_count * 50
    return frecency


def load_data(path=DATA_PATH):
    """
    Load CSV with new format: order,id,date,time,title,url,visitCount,typedCount,transition
    Returns DataFrame with 'url' and computed 'frecency' columns.
    """
    df = pd.read_csv(path)

    # Be forgiving about the URL column name: accept several common variants.
    possible_url_columns = ["url", "URL", "link", "Link", "website", "site"]
    url_column = None
    for col in possible_url_columns:
        if col in df.columns:
            url_column = col
            break

    if not url_column:
        raise ValueError(f"CSV must contain a URL column (one of {possible_url_columns})")

    # Drop rows where URL is missing and normalize into df['url']
    df = df.dropna(subset=[url_column])
    df["url"] = df[url_column].astype(str)

    # Compute frecency from new fields
    df["frecency"] = compute_frecency_from_new_format(df)

    # Clip outliers (99th percentile)
    high_cutoff = df["frecency"].quantile(0.99)
    df["frecency"] = np.clip(df["frecency"], 0, high_cutoff)

    return df


def parse_args():
    import argparse
    p = argparse.ArgumentParser(description='Train URL interest models from a CSV file')
    p.add_argument('--input', '-i', dest='input_path', default=None,
                   help='Path to input CSV file (required)')
    args = p.parse_args()
    return args


def basic_url_clean(urls):
    """Clean URLs for feature extraction"""
    out = []
    for u in urls:
        s = str(u).lower()
        s = s.replace("http://", "").replace("https://", "")
        for ch in ["/", "?", "&", "=", "-", "_", ".", "%20"]:
            s = s.replace(ch, " ")
        out.append(s)
    return out


def train():
    """Main training function"""
    logger.info(f"Loading data from {DATA_PATH}...")
    df = load_data()
    logger.info(f"Loaded {len(df)} records")
    
    X_raw = basic_url_clean(df["url"].astype(str).values)
    
    # Log-transform frecency for regression stability
    y_reg = np.log1p(df["frecency"].values)
    
    # Determine threshold if not provided
    global FRECENCY_THRESHOLD
    if FRECENCY_THRESHOLD is None:
        FRECENCY_THRESHOLD = float(np.median(y_reg))
        print(f"Using median log-frecency as threshold: {FRECENCY_THRESHOLD:.2f}")
    
    # Binary label for classifier
    y_clf = (y_reg >= FRECENCY_THRESHOLD).astype(int)
    
    # Check if we have enough samples
    if len(X_raw) < 10:
        raise ValueError("Not enough data to train. Need at least 10 samples.")
    
    # Train/test split
    X_train, X_test, yclf_train, yclf_test, yreg_train, yreg_test = train_test_split(
        X_raw, y_clf, y_reg, test_size=0.2, random_state=42, stratify=y_clf
    )
    
    logger.info(f"Training set: {len(X_train)} samples, Test set: {len(X_test)} samples")
    
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
    logger.info("Training classifier...")
    clf = LogisticRegression(max_iter=1000, random_state=42)
    clf.fit(Xtr, yclf_train)
    ypred_clf = clf.predict(Xte)
    
    logger.info("=== Classification report (high-interest vs low) ===")
    logger.info("\n%s", classification_report(yclf_test, ypred_clf, digits=4))
    
    # === REGRESSOR ===
    logger.info("Training regressor...")
    reg = GradientBoostingRegressor(
        n_estimators=250,
        max_depth=4,
        learning_rate=0.05,
        random_state=42
    )
    reg.fit(Xtr.toarray(), yreg_train)  # GradientBoosting needs dense input
    ypred_reg = reg.predict(Xte.toarray())
    
    # Evaluate in log-space (RMSE)
    # Some scikit-learn versions may not accept `squared` param; compute RMSE manually for compatibility.
    rmse_log = mean_squared_error(yreg_test, ypred_reg) ** 0.5
    r2_log = r2_score(yreg_test, ypred_reg)
    
    # Evaluate in real-space (optional, back-transform)
    ytrue_real = np.expm1(yreg_test)
    ypred_real = np.expm1(ypred_reg)
    rmse_real = mean_squared_error(ytrue_real, ypred_real) ** 0.5
    r2_real = r2_score(ytrue_real, ypred_real)
    
    logger.info("=== Regression metrics (predicting frecency) ===")
    logger.info("Log-space RMSE: %.4f | R²: %.4f", rmse_log, r2_log)
    logger.info("Real-space RMSE: %.4f | R²: %.4f", rmse_real, r2_real)
    
    # === SAVE MODELS ===
    logger.info(f"Saving models to {MODELS_DIR}...")
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, "vectorizer.pkl"))
    joblib.dump(clf, os.path.join(MODELS_DIR, "classifier.pkl"))
    joblib.dump(reg, os.path.join(MODELS_DIR, "regressor.pkl"))
    joblib.dump({"frecency_threshold": FRECENCY_THRESHOLD}, os.path.join(MODELS_DIR, "meta.pkl"))
    
    logger.info("✓ Training complete! All models saved.")


if __name__ == "__main__":
    try:
        args = parse_args()
        if not args.input_path:
            # Be strict: require an input path from the caller to avoid accidental use of local files
            raise SystemExit("Error: --input <path> is required. Callers should pass the uploaded CSV path.")
        # Train using provided input path
        DATA_PATH = args.input_path
        train()
    except SystemExit:
        raise
    except Exception as e:
        # Log full traceback to training_debug.log and stderr
        logger.exception("Unhandled exception during training")
        traceback.print_exc()
        raise
