# MetaCapstone: Browsing Interest Profiler

A lightweight, interpretable ML system that transforms raw browsing history into personalized interest score profiles and product recommendations.

## Overview

MetaCapstone AdApt analyzes user browsing activity to generate actionable insights about interests and preferences. By combining explainable machine learning models with transparent keyword extraction, the system produces ranked interest categories backed by representative keywords.

**Key Features:**
- Automatic website categorization using TF-IDF + Logistic Regression
- Interest strength scoring via Gradient Boosting Regressor
- Interpretable keyword extraction with stopword filtering
- Configurable brand/term overrides for common false positives
- Bias reduction through curated stopwords and frequency filtering
- Fast, re-trainable models (seconds to minutes)
- React dashboard with visualizations and interactive upload

---

## Technical Architecture

### Technology Stack

**Frontend:**
- React (SPA with hot reload)
- Tailwind CSS (utility-first styling)
- Node.js/npm (build & dev server)

**Backend:**
- FastAPI + Uvicorn (REST API, hot reload)
- Python 3.10+ (scikit-learn, pandas, numpy)
- pip/venv (dependency management)

**Machine Learning:**
- scikit-learn (TF-IDF, Logistic Regression, Gradient Boosting Regressor)
- Pandas, NumPy (data manipulation)
- Joblib (model serialization)

---

## System Architecture

### Subsystem 1: Frontend (Dashboard UI)
**Purpose:** User-facing interface for CSV upload, training trigger, and result visualization.

- Accepts browsing history CSV files
- Displays ranked interest categories with likelihoods
- Shows representative keywords and explanations
- Renders pie charts and interest breakdowns via visualizations
- Communicates with backend via HTTP/JSON endpoints

**Key Components:**
- `Dashboard.js`: Main orchestrator
- `DataUpload.js`: File input and submission
- `NestedPieChart.js`, `ClusteringViz.js`: Category visualizations
- `UserProfile.js`, `AdRecommendations.js`: Result display

### Subsystem 2: Backend API (FastAPI Service)
**Purpose:** REST endpoints for training and prediction; model orchestration.

Exposes endpoints:
- `/train` – trains the categorizer on labeled data
- `/predict` – generates interest profiles from browsing history
- Error handling and CORS support

Delegates to training and prediction modules; validates payloads; logs operations.

### Subsystem 3: ML Training – Content Categorizer
**Module:** `backend/train_categorizer.py`

Trains a text-based website categorizer:
- **Input:** `data/website_classification.csv` (URL, page text, category label)
- **Features:** TF-IDF on cleaned website text (1–2 grams, 20k max features, `max_df=0.85`)
- **Debiasing:** Union of sklearn English + default stopwords + `data/custom_stopwords.txt`
- **Model:** Logistic Regression (`class_weight='balanced'`, `C=0.5`, `max_iter=2000`)
- **Output:** Artifacts saved to `backend/models/`:
  - `categorizer_vectorizer.pkl`
  - `categorizer.pkl`
  - `categorizer_label_encoder.pkl`
- **Evaluation:** Accuracy, per-class precision/recall, stratified cross-validation

**Quality Controls:**
- Automatically drops classes with <2 samples
- Stratified split with fallback to non-stratified if needed
- Class balancing to handle imbalanced datasets
- Stopword and frequency filtering to reduce bias

### Subsystem 4: ML Training – Interest/Frecency Models
**Module:** `backend/train.py`

Trains URL-based interest strength models:
- **Input:** Browsing history CSVs (URL, visitCount, typedCount, etc.)
- **Target:** Frecency score (visit frequency + intentionality, log-transformed)
- **Models:**
  - Logistic Regression: binary classifier for "high-interest" URLs
  - Gradient Boosting Regressor: continuous interest score prediction
- **Features:** TF-IDF on cleaned URLs
- **Output:** Artifacts saved to `backend/models/`:
  - `classifier.pkl`, `vectorizer.pkl` (URL features)
  - `regressor.pkl` (frecency regressor)
  - `meta.pkl` (threshold, class distribution info)
- **Evaluation:** Classification report, MSE, R² score

### Subsystem 5: Prediction/Inference Pipeline
**Module:** `backend/predict.py`

Generates personalized interest profiles:

**Pipeline Steps:**
1. Clean incoming URLs (remove protocol, punctuation, tokenize)
2. Load all trained artifacts (vectorizers, classifiers, regressor, label encoder)
3. **Categorization:** Vectorize URLs → predict category
4. **Overrides:** Apply rule-based corrections:
   - Explicit brand/term overrides from `data/category_overrides.json` (e.g., `foodnetwork` → `Food`)
   - Derived category tokens (e.g., if "food" appears in URL, prioritize Food category)
5. **Interest Scoring:** Vectorize → predict frecency scores (non-negative)
6. **Aggregation:** Sum scores per category → normalize to likelihoods (0–1)
7. **Keyword Extraction:** Count non-stopword tokens within each category; filter to significant ones; scale by category strength
8. **Output:** JSON response with:
   - Ranked categories with likelihoods
   - Representative product keywords per category
   - Short explanations backed by keywords
   - Metadata (timestamp, model version, user pseudonym)

**Bias Reduction:**
- Shared stopword policy (training + prediction) ensures generic terms never appear as top keywords
- `max_df` filtering removes overly common tokens during training
- Custom stopwords config (`data/custom_stopwords.txt`) is editable and immediately applied

### Subsystem 6: Data & Configuration Storage
**Purpose:** Centralized storage for training data, configs, logs, and model artifacts.

**Files:**
- `data/website_classification.csv` – labeled site-category pairs (for categorizer training)
- `data/BrowsingHistory.csv`, sample histories – browsing activity (for interest model training)
- `data/custom_stopwords.txt` – editable list of generic/brand terms to exclude
- `data/category_overrides.json` – substring → category mappings for manual corrections
- `backend/models/` – serialized vectorizers, classifiers, regressors, label encoders
- `logs/training_debug.log` – training diagnostics

---

## How to Run

### Prerequisites
- Python 3.10+
- Node.js 14+
- Git

### Setup & Launch

#### 1. Backend Setup
```bash
# Navigate to project root
cd /path/to/MetaCapstone

# Activate virtual environment
.\.venv\Scripts\Activate.ps1          # Windows PowerShell
# or
source .venv/bin/activate            # macOS/Linux

# Navigate to backend
cd backend

# Install dependencies (if needed)
pip install -r requirements.txt
```

#### 2. Start Backend Server
```bash
cd backend
uvicorn app:app --reload --host 0.0.0.0 --port 8000
```
- API runs at `http://0.0.0.0:8000`
- `/docs` available for interactive API exploration (Swagger UI)
- Hot reload enabled for development

#### 3. Frontend Setup (in a new terminal)
```bash
# Navigate to frontend folder
cd frontend

# Install dependencies
npm install
```

#### 4. Start Frontend Server
```bash
cd frontend
npm start
```
- Dashboard runs at `http://localhost:3000`
- Hot reload enabled
- Proxies API calls to backend

#### 5. Full Stack Running
Once both are up:
1. Open `http://localhost:3000` in your browser
2. Upload a browsing history CSV via the Dashboard
3. Click "Train" or "Predict" to generate an interest profile
4. View results, keywords, and visualizations

---

## Data Formats

### Input: Browsing History CSV
Expected columns (minimum):
```
order, id, date, time, title, url, visitCount, typedCount, transition
```

Example:
```
1, 1234567890, 2025-01-15, 14:30, "Google", "https://google.com", 50, 10, "typed"
2, 1234567891, 2025-01-15, 14:35, "Food Network", "https://foodnetwork.com/recipes", 5, 2, "link"
```

### Input: Website Classification CSV (for categorizer training)
Expected columns:
```
URL, cleaned_website_text, Category
```

Example:
```
https://foodnetwork.com, "food recipes cooking shows", "Food"
https://espn.com, "sports news scores", "Sports"
```

### Output: Interest Profile JSON
```json
{
  "meta": {
    "user_pseudonym": "user_12345",
    "timestamp": "2025-01-15T14:35:00Z",
    "model_version": "v1.2.0-dynamic-products"
  },
  "categories": [
    {
      "name": "Food",
      "likelihood": 0.45,
      "products": [
        { "name": "Recipes", "likelihood": 0.15 },
        { "name": "Cooking", "likelihood": 0.12 }
      ],
      "explanation": [
        "recent activity related to: recipes",
        "recent activity related to: cooking"
      ]
    },
    {
      "name": "Sports",
      "likelihood": 0.30,
      "products": [...],
      "explanation": [...]
    }
  ]
}
```

---

## Configuration & Customization

### Custom Stopwords
Edit `backend/data/custom_stopwords.txt` to add or remove generic terms:
```
google
gmail
mail
inbox
login
account
www
com
...
```
Changes apply immediately on next prediction (backend hot-reloads).

### Category Overrides
Edit `backend/data/category_overrides.json` to force brand/term → category mappings:
```json
{
  "foodnetwork": "Food",
  "kitchenaid": "Food",
  "espn": "Sports",
  "nike": "Fashion",
  "adidas": "Fashion"
}
```

### Model Hyperparameters
Adjust in `backend/train_categorizer.py`:
- `ngram_range`: TF-IDF n-gram span (e.g., `(1, 2)` for unigrams + bigrams)
- `max_features`: Max vocabulary size (e.g., `20000`)
- `max_df`: Drop terms appearing in >X% of docs (e.g., `0.85`)
- `C`: Logistic Regression regularization strength
- `class_weight`: Balance class importance (`'balanced'` recommended)

Rerun training after any changes:
```bash
cd backend
python train_categorizer.py
```

---

## Development & Testing

### Running Tests
```bash
cd backend
pytest test_predict_override.py -v
```

### Logs
- Backend: `backend/logs/training_debug.log` (training diagnostics)
- Console: All prediction/inference steps logged to stdout

### Debugging
- Frontend: Chrome DevTools, React DevTools plugin
- Backend: FastAPI interactive docs at `http://localhost:8000/docs`

---

## Model Performance

### Categorizer (Text-based)
- **Accuracy:** ~85% on test split (varies by data balance)
- **Evaluation:** Per-class precision, recall, F1 (see training console output)
- **Training Time:** ~10–30 seconds

### Interest Scoring
- **Regressor (Frecency):** MSE and R² reported post-training
- **Classifier (High-Interest):** Classification report with precision/recall per class
- **Training Time:** ~10–20 seconds

---

## Failure Modes & Recovery

| Scenario | Impact | Recovery |
|----------|--------|----------|
| Backend down | Frontend shows error; no train/predict | Restart backend with `uvicorn` |
| Missing model artifacts | Prediction fails; error 5xx | Rerun training scripts (`train_categorizer.py`, `train.py`) |
| Missing stopwords file | Falls back to defaults; less debiasing | Ensure `data/custom_stopwords.txt` exists (created on first train) |
| Missing override config | Falls back to model prediction; less correction | Ensure `data/category_overrides.json` exists (created on startup) |
| Small dataset | Model accuracy drops; stratified split may fail | Filter tiny classes (<2 samples auto-dropped) or add more labeled data |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                  React Frontend (Port 3000)             │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │  Dashboard   │  │  Visualizer │  │ DataUpload   │  │
│  └──────┬───────┘  └──────┬──────┘  └──────┬───────┘  │
└─────────┼──────────────────┼──────────────────┼─────────┘
          │ HTTP/JSON        │                  │
          └──────────────────┼──────────────────┘
                             │
┌────────────────────────────┴────────────────────────────┐
│            FastAPI Backend (Port 8000)                  │
│  ┌──────────┐              ┌─────────────────┐         │
│  │ Endpoints│──────┬───────│ predict.py      │         │
│  │ /train   │      │       │ (inference)     │         │
│  │ /predict │      │       └────────┬────────┘         │
│  └──────────┘      │                │                  │
│                    ├────────────────┤                  │
│  ┌──────────────┐  │  ┌──────────────────────────┐    │
│  │train_categ   ├──┤  │ Artifact Loaders (joblib)│    │
│  │orizer.py     │  │  │ - vectorizer             │    │
│  │train.py      │  │  │ - classifier             │    │
│  └──────────────┘  │  │ - regressor              │    │
│                    │  │ - label encoder          │    │
│                    │  └──────────────────────────┘    │
│                    └────────────────────────────────────┘
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────┴────────────────────────────────┐
│              File System (Data & Models)                 │
│  ┌──────────────────┐      ┌──────────────────────────┐ │
│  │ Data/            │      │ Models/                  │ │
│  │ - *.csv          │      │ - *.pkl (artifacts)      │ │
│  │ - custom_...txt  │      │ - version tags           │ │
│  │ - overrides.json │      └──────────────────────────┘ │
│  └──────────────────┘                                   │
└────────────────────────────────────────────────────────────┘
```

---

## Key Features Explained

### Interpretability
Every prediction is backed by:
- **Keywords:** Top non-generic tokens from the user's visited sites
- **Category Confidence:** Likelihood scores (0–1) showing relative strength
- **Explanations:** Short, human-readable statements tied to keyword evidence
- **Override Transparency:** If a rule override was applied, the reason is traceable

### Bias Mitigation
1. **Stopword Union:** sklearn English + curated defaults + user-editable custom list
2. **Frequency Filtering:** `max_df=0.85` drops near-universal terms during training
3. **Class Balancing:** `class_weight='balanced'` in Logistic Regression
4. **Automatic Filtering:** Classes with <2 samples excluded before stratified split

### Configurability
- Edit `custom_stopwords.txt` to add/remove generic terms
- Edit `category_overrides.json` to force specific site → category mappings
- Adjust hyperparameters in training scripts and retrain in seconds

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit changes (`git commit -am 'Add feature'`)
4. Push to branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## License

This project is part of a capstone program. See LICENSE for details.

---

## Contact & Support

For questions, issues, or suggestions, please open a GitHub Issue or contact the development team.

---

## Acknowledgments

Built with scikit-learn, FastAPI, and React. Inspired by the need for transparent, user-respecting interest profiling.