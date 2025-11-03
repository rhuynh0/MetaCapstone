import React, { useState } from "react";
import "./Dashboard.css";

export default function Dashboard() {
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [userId, setUserId] = useState("user_12345");
  const [output, setOutput] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [jobStatus, setJobStatus] = useState(null);
  const [threshold, setThreshold] = useState(0.05);
  const [topK, setTopK] = useState(5);
  const [explain, setExplain] = useState(true);
  const [apiKey, setApiKey] = useState("");

  // Parse uploaded CSV file and extract URLs
  function parseCSV(text) {
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const urlIdx = headers.findIndex(h => h.toLowerCase().includes('url'));
    if (urlIdx === -1) return [];
    return lines.slice(1)
      .map(line => line.split(',')[urlIdx]?.replace(/"/g, '').trim())
      .filter(Boolean);
  }

  const [uploadedURLs, setUploadedURLs] = useState([]);
  const [inlineSample, setInlineSample] = useState("");
  function handleFileUpload(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setUploadedFileName(f.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      let urls = [];
      if (f.name.endsWith('.csv')) {
        urls = parseCSV(event.target.result);
      } else if (f.name.endsWith('.json')) {
        try {
          const data = JSON.parse(event.target.result);
          if (Array.isArray(data)) {
            urls = data.map(row => row.url).filter(Boolean);
          }
        } catch {}
      }
      setUploadedURLs(urls);
    };
    reader.readAsText(f);
  }

  async function runInference() {
    setProcessing(true);
    setOutput(null);
    setJobStatus({ status: 'starting', message: 'Initializing retrain...' });
    try {
      // If no uploaded data, prompt user and emit console messages for a short time
      if ((!uploadedURLs || uploadedURLs.length === 0) && !inlineSample) {
        console.warn("No file or inline sample provided. Please upload a CSV/JSON with a 'url' column or paste a sample.");
        // show lightweight console 'processing' messages for ~2 seconds to give the user time
        console.log("Waiting for input... (upload a file or paste sample in the text area)");
        await new Promise((resolve) => {
          console.log("Tip: upload a CSV with a 'url' column to run category predictions.");
          setTimeout(() => {
            console.log('Still waiting...');
            setTimeout(resolve, 1000);
          }, 800);
        });
        setProcessing(false);
        return;
      }

      // Prepare request payload: prefer uploaded file urls, otherwise try inline sample
      let payload = null;
      if (uploadedURLs && uploadedURLs.length > 0) {
        payload = { urls: uploadedURLs };
      } else if (inlineSample) {
        try {
          const parsed = JSON.parse(inlineSample);
          if (Array.isArray(parsed)) {
            payload = { urls: parsed.map((r) => r.url).filter(Boolean) };
          }
        } catch (e) {
          // not JSON - leave payload null so backend will fallback
          console.warn('Inline sample could not be parsed as JSON; sending no payload so backend may use history fallback.');
        }
      }

      // Start retraining asynchronously via /retrain, then poll job status
      const retrainResp = await fetch('http://localhost:8000/retrain', { method: 'POST' });
      const retrainJson = await retrainResp.json();
      const jobId = retrainJson.job_id;
      setJobStatus({ status: 'queued', message: 'Training queued', jobId });

      // Poll job status until succeeded/failed
      let finalStatus = null;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const stResp = await fetch(`http://localhost:8000/job-status/${jobId}`);
        const stJson = await stResp.json();
        setJobStatus(stJson);
        if (stJson.status === 'succeeded') {
          finalStatus = 'succeeded';
          break;
        }
        if (stJson.status === 'failed') {
          finalStatus = 'failed';
          break;
        }
      }

      if (finalStatus !== 'succeeded') {
        throw new Error('Training failed: ' + (jobStatus && jobStatus.message));
      }

      // Training succeeded — now call predict-categories (no retrain flag)
      const response = await fetch("http://localhost:8000/predict-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      const data = await response.json();
      
      // Filter and format results
      const filtered = {
        meta: data.meta || {
          user_pseudonym: userId,
          timestamp: new Date().toISOString(),
          model_version: "backend-categories",
        },
        categories: (data.categories || [])
          .map((c) => ({ 
            ...c, 
            likelihood: Number(c.likelihood.toFixed(2)),
            products: (c.products || []).map(p => ({
              ...p,
              likelihood: Number(p.likelihood.toFixed(3))
            }))
          }))
          .filter((c) => c.likelihood >= threshold)
          .slice(0, topK),
      };
      setOutput(filtered);
    } catch (err) {
      console.error("Prediction error:", err);
      setOutput({ meta: { error: "Prediction failed: " + err.message }, categories: [] });
    } finally {
      setProcessing(false);
      setJobStatus(null);
    }
  }

  function downloadJSON() {
    if (!output) return;
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(output, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `${userId}_predictions.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function downloadCSV() {
    if (!output) return;
    const rows = [
      "user_pseudonym,timestamp,category,category_likelihood,product,product_likelihood,explanation",
    ];
    output.categories.forEach((c) => {
      const expl = (c.explanation || []).join(" | ");
      c.products.forEach((p) => {
        rows.push(
          `${output.meta.user_pseudonym},${output.meta.timestamp},${c.name},${c.likelihood},${p.name},${p.likelihood},"${expl}"`
        );
      });
    });
    const csvContent =
      "data:text/csv;charset=utf-8," + encodeURIComponent(rows.join("\n"));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", csvContent);
    dlAnchor.setAttribute("download", `${userId}_predictions.csv`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  }

  function copyJSONToClipboard() {
    if (!output) return;
    navigator.clipboard &&
      navigator.clipboard.writeText(JSON.stringify(output, null, 2));
  }

  return (
    <div className="dashboard-container">
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="header-title-group">
            <div className="header-icon">AI</div>
            <div>
              <h1 className="header-title">AI Ad Targeting — Demo UI</h1>
              <p className="header-subtitle">
                Predict category & product-level ad engagement with
                explainability and export options.
              </p>
            </div>
          </div>
          <div className="header-model-info">
            <div className="model-info-text">
              <div className="model-label">Model</div>
              <div className="model-version">v0.9.1-demo</div>
            </div>
            <button className="settings-button">Settings</button>
          </div>
        </header>

        <main className="main-grid">
          {/* Left panel: Inputs */}
          <section className="input-panel">
            <h2 className="panel-title">Input / Ingestion</h2>
            <p className="panel-description">
              Provide a browsing-history file or paste a sample. This demo uses
              mock predictions.
            </p>

            <label className="form-label">User pseudonym</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="text-input"
            />

            <label className="form-label">
              Upload browsing history (JSON / CSV)
            </label>
            <input
              type="file"
              accept=".json,.csv,text/csv,application/json"
              onChange={handleFileUpload}
              className="file-input"
            />
            <div className="file-status">
              {uploadedFileName
                ? `Selected: ${uploadedFileName}`
                : "No file selected"}
            </div>

            <label className="form-label">Inline sample (optional)</label>
            <textarea
              placeholder='[ {"url": "https://example.com/product/123", "timestamp": "2025-09-28T10:00:00Z" } ]'
              className="textarea-input"
              value={inlineSample}
              onChange={(e) => setInlineSample(e.target.value)}
            />

            <div className="slider-control">
              <label className="control-label">Threshold</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="slider"
              />
              <div className="slider-value">{Math.round(threshold * 100)}%</div>
            </div>

            <div className="number-control">
              <label className="control-label">Top K categories</label>
              <input
                type="number"
                min="1"
                max="20"
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="number-input"
              />
            </div>

            <div className="button-group">
              <button
                onClick={runInference}
                disabled={processing}
                className="run-button"
              >
                {processing ? "Processing…" : "Run Prediction"}
              </button>
              {/* jobStatus is shown in the output panel placeholder; no duplicate needed here */}
              <button
                onClick={() => {
                  setOutput(null);
                  setUploadedFileName(null);
                  setUploadedURLs([]);
                  setInlineSample("");
                }}
                className="clear-button"
              >
                Clear
              </button>
            </div>

            <div className="settings-section">
              <div className="section-label">Explainability</div>
              <div className="checkbox-control">
                <input
                  id="explain"
                  type="checkbox"
                  checked={explain}
                  onChange={(e) => setExplain(e.target.checked)}
                />
                <label htmlFor="explain" className="checkbox-label">
                  Include per-prediction explanations
                </label>
              </div>
            </div>

            <div className="settings-section">
              <div className="section-title">Integration</div>
              <div className="section-subtitle">
                API key (optional, for connecting to a backend)
              </div>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="text-input"
                placeholder="sk-..."
              />
            </div>
          </section>

          {/* Right panel: Output */}
          <section className="output-panel">
            <div className="output-header">
              <h2 className="panel-title">Prediction Output</h2>
              <div className="export-buttons">
                <button
                  onClick={downloadJSON}
                  disabled={!output}
                  className="export-button"
                >
                  Download JSON
                </button>
                <button
                  onClick={downloadCSV}
                  disabled={!output}
                  className="export-button"
                >
                  Download CSV
                </button>
                <button
                  onClick={copyJSONToClipboard}
                  disabled={!output}
                  className="export-button"
                >
                  Copy JSON
                </button>
              </div>
            </div>

            <div className="output-content">
              {!output && (
                <div className="output-placeholder">
                  {jobStatus ? (
                    <div>
                      <span className="spinner-inline" aria-hidden="true" />
                      <span>{jobStatus.message}</span>
                    </div>
                  ) : (
                    "No predictions yet. Run a prediction to see results here."
                  )}
                </div>
              )}

              {output && (
                <div className="output-results">
                  <div className="results-meta">
                    <div>
                      <div className="meta-label">User</div>
                      <div className="meta-value">
                        {output.meta.user_pseudonym}
                      </div>
                    </div>
                    <div>
                      <div className="meta-label">Timestamp</div>
                      <div className="meta-value-sm">
                        {new Date(output.meta.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <div>
                      <div className="meta-label">Model</div>
                      <div className="meta-value-sm">
                        {output.meta.model_version}
                      </div>
                    </div>
                  </div>

                  <div className="category-list">
                    {output.categories.map((cat, idx) => (
                      <div key={idx} className="category-item">
                        <div className="category-header">
                          <div>
                            <div className="category-title-group">
                              <h3 className="category-name">{cat.name}</h3>
                              <div className="category-likelihood">
                                {Math.round(cat.likelihood * 100)}% likelihood
                              </div>
                            </div>
                            <div className="product-list">
                              {cat.products.map((p, i) => (
                                <div key={i} className="product-item">
                                  <div className="product-name">{p.name}</div>
                                  <div className="progress-bar-container">
                                    <div
                                      style={{
                                        width: `${Math.round(
                                          p.likelihood * 100
                                        )}%`,
                                      }}
                                      className="progress-bar"
                                    />
                                  </div>
                                  <div className="product-likelihood">
                                    {Math.round(p.likelihood * 100)}%
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="category-actions">
                            <div className="actions-label">Action</div>
                            <div className="action-buttons">
                              <button className="action-button">
                                Preview Creatives
                              </button>
                              <button className="action-button">
                                Create Segment
                              </button>
                              <button className="action-button">
                                Push to DSP
                              </button>
                            </div>
                          </div>
                        </div>
                        {explain && cat.explanation && (
                          <details className="explanation-details">
                            <summary className="explanation-summary">
                              Why this prediction?
                            </summary>
                            <ul className="explanation-list">
                              {cat.explanation.map((e, i) => (
                                <li key={i}>{e}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="raw-output-section">
                    <div className="raw-output-label">
                      Raw output (for integrations / API)
                    </div>
                    <pre className="raw-output-pre">
                      {JSON.stringify(output, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>

            <div className="output-footer">
              <div>
                <div>
                  Latency (simulated):{" "}
                  <span className="footer-value">~600ms</span>
                </div>
                <div>
                  Inference threshold:{" "}
                  <span className="footer-value">
                    {Math.round(threshold * 100)}%
                  </span>
                </div>
              </div>
              <div className="footer-note">
                <div>Export: JSON / CSV</div>
                <div className="footer-note-details">
                  Use the integration panel to configure API endpoints for
                  production.
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="dashboard-footer">
          Temporary frontend mockup — will replace the mock output with
          backend model and APIs.
        </footer>
      </div>
    </div>
  );
}