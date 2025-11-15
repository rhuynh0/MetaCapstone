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
import shutil
from fastapi import BackgroundTasks, HTTPException, UploadFile, File
import logging
from pathlib import Path

# Setup logging for backend: write to logs/backend.log and stdout
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)
logger = logging.getLogger("metacap.backend")
if not logger.handlers:
    logger.setLevel(logging.DEBUG)
    fh = logging.FileHandler(log_dir / "backend.log", encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    ch = logging.StreamHandler()
    ch.setLevel(logging.DEBUG)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    fh.setFormatter(fmt)
    ch.setFormatter(fmt)
    logger.addHandler(fh)
    logger.addHandler(ch)

MODELS_DIR = "models"
# Lazy-loaded model artifacts. Keep them None at import time so the
# FastAPI app can start even when model files are missing. Call
# `ensure_models_loaded()` before using these in endpoints.
vectorizer = None
clf = None
meta = None
threshold = None


def ensure_models_loaded():
    """Attempt to load model artifacts into module-level variables.
    Returns True if models are available, False otherwise.
    """
    global vectorizer, clf, meta, threshold
    # If already loaded, nothing to do
    if vectorizer is not None and clf is not None and meta is not None:
        return True
    try:
        vectorizer = joblib.load(os.path.join(MODELS_DIR, "vectorizer.pkl"))
        clf = joblib.load(os.path.join(MODELS_DIR, "classifier.pkl"))
        meta = joblib.load(os.path.join(MODELS_DIR, "meta.pkl"))
        threshold = meta.get("frecency_threshold", None)
        logger.info("Models loaded successfully")
        return True
    except Exception as e:
        # Log for server insights and leave variables as None
        logger.warning(f"Models not available at startup: {e}")
        vectorizer = None
        clf = None
        meta = None
        threshold = None
        return False

app = FastAPI(title="URL Interest Predictor")

# Path to most recently uploaded CSV (set when client uploads via upload-and-retrain).
# This lets the prediction endpoint use the CSV the frontend just uploaded instead
# of falling back to a hard-coded file path.
LATEST_UPLOADED_CSV = None

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
    # Ensure model artifacts are available before attempting prediction.
    if not ensure_models_loaded():
        return {"error": "Model artifacts not found. POST to /retrain or upload a CSV to /upload-and-retrain to generate models."}
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
    logger.debug("/predict_from_csv called; reading uploaded CSV")
    try:
        df = pd.read_csv(file.file)
    except Exception as e:
        logger.exception("Failed to read uploaded CSV in /predict_from_csv")
        return {"error": f"Failed to read CSV: {str(e)}"}
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
            logger.info("Retrain requested or model artifacts missing. Running training scripts...")
            # Run train.py and train_categorizer.py sequentially using sys.executable to respect venv
            try:
                start = time.time()
                # Ensure we run train.py with the uploaded CSV path so train.py doesn't fall back to any local defaults
                if not LATEST_UPLOADED_CSV or not os.path.exists(LATEST_UPLOADED_CSV):
                    logger.error("No uploaded CSV available to train on. Aborting training run.")
                    return {"error": "No uploaded CSV available. Upload a CSV via /upload-and-retrain before retraining."}
                train_cmd = [sys.executable, "train.py", "--input", LATEST_UPLOADED_CSV]
                logger.debug("Running training command: %s", train_cmd)
                r1 = subprocess.run(train_cmd, cwd='.', capture_output=True, text=True)
                logger.debug(f"train.py exit={r1.returncode}; stdout={r1.stdout[:1000]}; stderr={r1.stderr[:1000]}")
                if r1.returncode != 0:
                    # Include stderr/stdout to aid debugging (trim to reasonable length)
                    err_msg = (r1.stderr or r1.stdout or "Unknown error").strip()
                    logger.error("train.py failed: %s", err_msg[:1000])
                    return {"error": f"train.py failed: {err_msg[:200]}"}
                r2 = subprocess.run([sys.executable, "train_categorizer.py", "--input", LATEST_UPLOADED_CSV], cwd='.', capture_output=True, text=True)
                logger.debug(f"train_categorizer.py exit={r2.returncode}; stdout={r2.stdout[:1000]}; stderr={r2.stderr[:1000]}")
                if r2.returncode != 0:
                    err_msg = (r2.stderr or r2.stdout or "Unknown error").strip()
                    logger.error("train_categorizer.py failed: %s", err_msg[:1000])
                    return {"error": f"train_categorizer.py failed: {err_msg[:200]}"}
                logger.info(f"Training completed in {time.time() - start:.1f}s")
            except Exception as t_err:
                logger.exception("Training step raised exception")
                return {"error": f"Training step failed: {str(t_err)}"}

        import predict

        urls = None
        if payload and isinstance(payload, dict):
            urls = payload.get("urls")

        # If no URLs were provided in the JSON payload, try to fall back to the
        # most recently uploaded CSV (if any) which the user uploaded via
        # /upload-and-retrain. This ensures the frontend upload is actually
        # used by prediction rather than relying on local default files.
        if not urls:
            if LATEST_UPLOADED_CSV and os.path.exists(LATEST_UPLOADED_CSV):
                try:
                    df = pd.read_csv(LATEST_UPLOADED_CSV)
                    if "url" in df.columns:
                        urls = df["url"].astype(str).tolist()
                    else:
                        return {"error": "Uploaded CSV missing 'url' column; include urls in request or upload a CSV with a 'url' column."}
                except Exception as e:
                    return {"error": f"Failed to read uploaded CSV for prediction: {str(e)}"}

        if not urls:
            return {"error": "No URLs supplied for prediction. Please upload a CSV via /upload-and-retrain or POST {\"urls\": [...] } to /predict-categories."}

        # Call predict with URLs extracted from payload or uploaded CSV
        result = predict.generate_interest_profile(urls=urls)
        return result
    except Exception as e:
        return {"error": f"Category prediction failed: {str(e)}"}
    
@app.post('/upload-and-retrain', status_code=202)
async def upload_and_retrain(file: UploadFile = File(...)):
    """
    Upload a CSV file with browsing history, save it, and trigger retraining.
    Expected CSV format: order,id,date,time,title,url,visitCount,typedCount,transition
    """
    try:
        # Validate file extension
        if not file.filename.endswith('.csv'):
            raise HTTPException(status_code=400, detail='File must be a CSV')
        
        # Save uploaded file to data directory and record path so prediction
        # endpoints can use the exact CSV that the client uploaded.
        data_dir = "data"
        os.makedirs(data_dir, exist_ok=True)
        file_path = os.path.join(data_dir, "BrowsingHistory.csv")

        # Write uploaded file to disk
        try:
            with open(file_path, 'wb') as f:
                shutil.copyfileobj(file.file, f)
            logger.info(f"Uploaded file saved to {file_path} (size={os.path.getsize(file_path)} bytes)")
        except Exception as e:
            logger.exception("Failed to save uploaded CSV in /upload-and-retrain")
            raise

        # Remember latest uploaded CSV path so /predict-categories can use it
        global LATEST_UPLOADED_CSV
        LATEST_UPLOADED_CSV = file_path

        # Start retraining in background
        job_id = str(uuid.uuid4())
        JOB_STORE[job_id] = {'status': 'pending', 'message': 'CSV uploaded, training queued'}

        try:
            t = threading.Thread(target=_run_training_job, args=(job_id,), daemon=True)
            t.start()
        except Exception as thread_err:
            JOB_STORE[job_id]['status'] = 'failed'
            JOB_STORE[job_id]['message'] = f"Failed to start training thread: {str(thread_err)}"
            raise

        return {
            'job_id': job_id,
            'status': 'pending',
            'message': 'CSV uploaded successfully. Training started.'
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Upload failed: {str(e)}')


# --- Simple in-memory job store for background training jobs ---
JOB_STORE = {}
# JOB_STORE[job_id] = { 'status': 'pending'|'running'|'succeeded'|'failed', 'message': str }

def _run_training_job(job_id: str):
    JOB_STORE[job_id] = {'status': 'running', 'message': 'Starting training...'}
    try:
        start = time.time()
        JOB_STORE[job_id]['message'] = 'Running train.py'
        # Ensure we have an uploaded CSV to train on
        if not LATEST_UPLOADED_CSV or not os.path.exists(LATEST_UPLOADED_CSV):
            JOB_STORE[job_id]['status'] = 'failed'
            JOB_STORE[job_id]['message'] = 'No uploaded CSV available for training.'
            logger.error('No uploaded CSV available for background training job %s', job_id)
            return
        train_cmd = [sys.executable, 'train.py', '--input', LATEST_UPLOADED_CSV]
        logger.debug('Background training command: %s', train_cmd)
        r1 = subprocess.run(train_cmd, cwd='.', capture_output=True, text=True)
        JOB_STORE[job_id]['message'] = 'train.py finished'
        logger.debug("train.py exit=%s", r1.returncode)
        # Write subprocess output to a persistent debug file for easy inspection
        debug_path = os.path.join(MODELS_DIR, 'training_debug.log')
        try:
            with open(debug_path, 'a', encoding='utf-8') as dbg:
                dbg.write("\n--- train.py stdout (exit=%s) ---\n" % (r1.returncode,))
                dbg.write((r1.stdout or '')[:10000])
                dbg.write("\n--- train.py stderr ---\n")
                dbg.write((r1.stderr or '')[:10000])
        except Exception:
            logger.exception("Failed to write training debug log for train.py")

        if r1.returncode != 0:
            JOB_STORE[job_id]['status'] = 'failed'
            out = (r1.stderr or r1.stdout or "").strip()
            JOB_STORE[job_id]['message'] = f"train.py failed: {out[:1000]}"
            return

        JOB_STORE[job_id]['message'] = 'Running train_categorizer.py'
        # train_categorizer trains a separate categorizer dataset; do not pass browsing CSV
        r2 = subprocess.run([sys.executable, 'train_categorizer.py'], cwd='.', capture_output=True, text=True)
        JOB_STORE[job_id]['message'] = 'train_categorizer.py finished'
        logger.debug(f"train_categorizer.py exit={r2.returncode}")
        try:
            with open(debug_path, 'a', encoding='utf-8') as dbg:
                dbg.write("\n--- train_categorizer.py stdout (exit=%s) ---\n" % (r2.returncode,))
                dbg.write((r2.stdout or '')[:10000])
                dbg.write("\n--- train_categorizer.py stderr ---\n")
                dbg.write((r2.stderr or '')[:10000])
        except Exception:
            logger.exception("Failed to write training debug log for train_categorizer.py")

        if r2.returncode != 0:
            JOB_STORE[job_id]['status'] = 'failed'
            out = (r2.stderr or r2.stdout or "").strip()
            JOB_STORE[job_id]['message'] = f"train_categorizer.py failed: {out[:1000]}"
            return

        JOB_STORE[job_id]['status'] = 'succeeded'
        JOB_STORE[job_id]['message'] = f"Training completed in {time.time() - start:.1f}s"
    except Exception as ex:
        JOB_STORE[job_id]['status'] = 'failed'
        # Include exception text to aid frontend debugging
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
