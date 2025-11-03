# small FastAPI app for future integration
# app.py
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import joblib
import os
import pandas as pd
from typing import List
import subprocess
import time
import sys
import threading
import uuid
from fastapi import BackgroundTasks, HTTPException

MODELS_DIR = "models"
vectorizer = joblib.load(os.path.join(MODELS_DIR, "vectorizer.pkl"))
clf = joblib.load(os.path.join(MODELS_DIR, "classifier.pkl"))
meta = joblib.load(os.path.join(MODELS_DIR, "meta.pkl"))
threshold = meta.get("frecency_threshold", None)

app = FastAPI(title="URL Interest Predictor")

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PredictRequest(BaseModel):
    urls: List[str]

@app.post("/predict")
async def predict(request: PredictRequest):
    urls = request.urls
    # same basic cleaning as train.py
    def clean(url):
        s = str(url).lower().replace("http://", "").replace("https://", "")
        for ch in ["/", "?", "&", "=", "-", "_", ".", "%20"]:
            s = s.replace(ch, " ")
        return s
    X = [clean(u) for u in urls]
    Xvec = vectorizer.transform(X)
    prob = clf.predict_proba(Xvec)[:,1]  # probability of high interest
    results = []
    for u,p in zip(urls, prob):
        results.append({"url": u, "high_interest_prob": float(p), "threshold": float(threshold)})
    return {"predictions": results}

# small CSV upload endpoint (optional)
@app.post("/predict_from_csv")
async def predict_from_csv(file: UploadFile = File(...)):
    df = pd.read_csv(file.file)
    if "url" not in df.columns:
        return {"error": "CSV must include 'url' column"}
    urls = df["url"].astype(str).tolist()
    return await predict(PredictRequest(urls=urls))

# Advanced prediction endpoint with categories
@app.post("/predict-categories")
async def predict_categories(payload: dict = None):
    """
    Generate category-based interest profile using predict.py logic.
    Optionally accepts JSON body: { "urls": ["http://...", ...] }
    If no urls provided, predict.generate_interest_profile() will fallback to reading history file.
    """
    try:
        # If model artifacts are missing, run the training scripts so predictions can be generated.
        def models_exist():
            required = [
                "vectorizer.pkl",
                "classifier.pkl",
                "regressor.pkl",
                "categorizer.pkl",
                "categorizer_vectorizer.pkl",
                "categorizer_label_encoder.pkl",
                "meta.pkl",
            ]
            return all(os.path.exists(os.path.join(MODELS_DIR, f)) for f in required)

        retrain_requested = False
        if payload and isinstance(payload, dict):
            retrain_requested = bool(payload.get("retrain", False))

        if retrain_requested or not models_exist():
            print("Retrain requested or model artifacts missing. Running training scripts...")
            # Run train.py and train_categorizer.py sequentially using sys.executable to respect venv
            try:
                start = time.time()
                res1 = subprocess.run([sys.executable, "train.py"], cwd=".")
                if res1.returncode != 0:
                    return {"error": "train.py failed; see server logs for details"}
                res2 = subprocess.run([sys.executable, "train_categorizer.py"], cwd=".")
                if res2.returncode != 0:
                    return {"error": "train_categorizer.py failed; see server logs for details"}
                print(f"Training completed in {time.time() - start:.1f}s")
            except Exception as t_err:
                return {"error": f"Training step failed: {str(t_err)}"}

        import predict
        urls = None
        if payload and isinstance(payload, dict):
            urls = payload.get("urls")
        # Call predict with optional urls list
        result = predict.generate_interest_profile(urls=urls)
        return result
    except Exception as e:
        return {"error": f"Category prediction failed: {str(e)}"}


# --- Simple in-memory job store for background training jobs ---
JOB_STORE = {}
# JOB_STORE[job_id] = { 'status': 'pending'|'running'|'succeeded'|'failed', 'message': str }

def _run_training_job(job_id: str):
    JOB_STORE[job_id] = {'status': 'running', 'message': 'Starting training...'}
    try:
        start = time.time()
        JOB_STORE[job_id]['message'] = 'Running train.py'
        r1 = subprocess.run([sys.executable, 'train.py'], cwd='.', capture_output=True, text=True)
        JOB_STORE[job_id]['message'] = 'train.py finished'
        if r1.returncode != 0:
            JOB_STORE[job_id]['status'] = 'failed'
            JOB_STORE[job_id]['message'] = f"train.py failed: {r1.stderr[:200]}"
            return

        JOB_STORE[job_id]['message'] = 'Running train_categorizer.py'
        r2 = subprocess.run([sys.executable, 'train_categorizer.py'], cwd='.', capture_output=True, text=True)
        JOB_STORE[job_id]['message'] = 'train_categorizer.py finished'
        if r2.returncode != 0:
            JOB_STORE[job_id]['status'] = 'failed'
            JOB_STORE[job_id]['message'] = f"train_categorizer.py failed: {r2.stderr[:200]}"
            return

        JOB_STORE[job_id]['status'] = 'succeeded'
        JOB_STORE[job_id]['message'] = f"Training completed in {time.time() - start:.1f}s"
    except Exception as ex:
        JOB_STORE[job_id]['status'] = 'failed'
        JOB_STORE[job_id]['message'] = f"Training exception: {str(ex)}"


@app.post('/retrain', status_code=202)
async def retrain_endpoint():
    """Start retraining in background and return a job id to poll."""
    job_id = str(uuid.uuid4())
    JOB_STORE[job_id] = {'status': 'pending', 'message': 'Queued'}
    # Start background thread
    t = threading.Thread(target=_run_training_job, args=(job_id,), daemon=True)
    t.start()
    return {'job_id': job_id, 'status': 'pending'}


@app.get('/job-status/{job_id}')
async def job_status(job_id: str):
    info = JOB_STORE.get(job_id)
    if not info:
        raise HTTPException(status_code=404, detail='Job not found')
    return {'job_id': job_id, 'status': info['status'], 'message': info.get('message','')}
