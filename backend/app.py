# small FastAPI app for future integration
# app.py
from fastapi import FastAPI, UploadFile, File, Form
from pydantic import BaseModel
import joblib
import os
import pandas as pd
from typing import List

MODELS_DIR = "models"
vectorizer = joblib.load(os.path.join(MODELS_DIR, "vectorizer.pkl"))
clf = joblib.load(os.path.join(MODELS_DIR, "classifier.pkl"))
meta = joblib.load(os.path.join(MODELS_DIR, "meta.pkl"))
threshold = meta.get("frecency_threshold", None)

app = FastAPI(title="URL Interest Predictor")

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
