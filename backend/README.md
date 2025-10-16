# Backend Service

This is the backend service for the Meta Capstone project. It provides RESTful APIs for data processing, model training, and predictions.

## Setup

1. Create a virtual environment:

```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Running the Server

```bash
python app.py
```

The server will start at http://localhost:5000

## API Endpoints

### POST /api/predict

Makes predictions based on input features.

Request body:

```json
{
    "features": [...]  # Array of feature values
}
```

Response:

```json
{
    "success": true,
    "prediction": [...],  # Array of predictions
    "message": "Prediction successful"
}
```

### POST /api/cluster

Performs clustering on input data.

Request body:

```json
{
    "features": [...]  # Array of feature values
}
```

Response:

```json
{
    "success": true,
    "clusters": [...],  # Array of cluster assignments
    "message": "Clustering successful"
}
```

## Project Structure

-   `app.py`: Main Flask application
-   `models/`: Machine learning models
    -   `dummy_model.py`: Example model implementation

## One-command training + prediction

A convenience runner is provided to execute the three scripts in order:

-   `train.py` (trains URL-based models)
-   `train_categorizer.py` (trains the website categorizer)
-   `predict.py` (generates the interest profile using saved models)

Usage:

```bash
cd backend
# dry-run: shows what will be executed without importing heavy native packages
python run_all.py --dry-run

# actual run
python run_all.py
# OR 
python3 run_all.py --subprocess
```

The runner will import each module and call the expected function. If a module
doesn't expose a callable, the runner falls back to running the module as a
script (so `if __name__ == '__main__'` blocks will still execute).
