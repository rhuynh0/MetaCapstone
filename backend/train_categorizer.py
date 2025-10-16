import os
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import classification_report, accuracy_score
from sklearn.preprocessing import LabelEncoder
import joblib

# --- Configuration ---
DATA_PATH = os.path.join("data", "website_classification.csv")
MODELS_DIR = "models"
os.makedirs(MODELS_DIR, exist_ok=True)

def train_categorizer():
    print("Loading dataset...")
    df = pd.read_csv(DATA_PATH, index_col=0)
    df.dropna(subset=['cleaned_website_text', 'Category'], inplace=True)

    # --- THIS IS THE KEY CHANGE ---
    # We are now using the rich text from the website, not the URL.
    X_raw = df['cleaned_website_text'].astype(str).values
    # --- END KEY CHANGE ---

    y_text = df['Category'].values

    # Check for class imbalance (good practice)
    print("Class Distribution:")
    print(df['Category'].value_counts())
    print("-" * 30)

    # Encode text labels to integers
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(y_text)

    # Split the data
    X_train, X_test, y_train, y_test = train_test_split(
        X_raw, y, test_size=0.2, random_state=42, stratify=y
    )

    # Create a simple, powerful pipeline: Vectorizer -> Classifier
    # We use word-level analysis now because we have full sentences.
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2), # Look at single words and two-word phrases
        max_features=20000,
        sublinear_tf=True,  # Smooths term frequencies
        stop_words='english'
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
    # Fit the vectorizer on the training data
    X_train_vec = vectorizer.fit_transform(X_train)

    # Train the classifier
    classifier.fit(X_train_vec, y_train)

    # Evaluate the model
    print("Evaluating model performance...")
    X_test_vec = vectorizer.transform(X_test)
    y_pred = classifier.predict(X_test_vec)

    accuracy = accuracy_score(y_test, y_pred)
    print(f"\n--- Model Accuracy: {accuracy:.4f} ---")
    
    # Print a detailed report
    print("\nClassification Report:")
    # We need to use the original text labels for the report
    target_names = label_encoder.classes_
    print(classification_report(y_test, y_pred, target_names=target_names))

    # Save the simplified model artifacts
    print("Saving model artifacts...")
    joblib.dump(vectorizer, os.path.join(MODELS_DIR, "categorizer_vectorizer.pkl"))
    joblib.dump(classifier, os.path.join(MODELS_DIR, "categorizer.pkl")) # Simplified name
    joblib.dump(label_encoder, os.path.join(MODELS_DIR, "categorizer_label_encoder.pkl"))
    
    print("Training complete and artifacts saved.")

if __name__ == "__main__":
    train_categorizer()