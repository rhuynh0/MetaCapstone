import React, { useState, useRef } from "react";
import "./Dashboard.css";
import NestedPieChart from "../components/NestedPieChart";

export default function Dashboard() {
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [userId, setUserId] = useState("user_12345");
  const [output, setOutput] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [jobStatus, setJobStatus] = useState(null);
  const threshold = 0.05;
  const [topK, setTopK] = useState(5);
  const [explain, setExplain] = useState(true);

  // Parse uploaded CSV file and extract URLs. This is a lightweight parser:
  // - strips a leading BOM
  // - splits lines on CRLF or LF
  // - splits columns on commas that are not inside quotes
  // - trims surrounding quotes/spaces
  // - looks for common header names (url, website, link, site)
  function parseCSV(text) {
    if (!text) return [];
    // remove BOM if present
    text = text.replace(/^\uFEFF/, '');
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length < 1) return [];

    const splitLine = (line) =>
      line.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(s => s.trim().replace(/^\"|\"$/g, ''));

    const headers = splitLine(lines[0]).map(h => h.toLowerCase());
    const urlIdx = headers.findIndex(h => h.includes('url') || h.includes('website') || h.includes('link') || h.includes('site'));
    if (urlIdx === -1) return [];

    return lines.slice(1)
      .map(line => splitLine(line)[urlIdx])
      .filter(Boolean)
      .map(s => s.trim());
  }

  const [uploadedURLs, setUploadedURLs] = useState([]);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [parseError, setParseError] = useState(null);
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadedFileSize, setUploadedFileSize] = useState(null);
  function handleFileUpload(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    // call but don't await here - UI will still update when parsing completes
    processFile(f);
  }

  // Process file and return a Promise that resolves to parsed URLs.
  // This lets callers await parsing (useful if Run is clicked immediately after upload).
  function processFile(f) {
    setParseError(null);
    setUploadedFile(f);
    setUploadedFileName(f.name);
    setUploadedFileSize(f.size || null);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        let urls = [];
        const text = event.target.result || "";
        if (f.name.toLowerCase().endsWith('.csv')) {
          urls = parseCSV(text);
          if (!urls || urls.length === 0) {
            // clear uploaded file state and show parse error popup
            setUploadedFileName(null);
            setUploadedFile(null);
            setUploadedFileSize(null);
            setUploadedURLs([]);
            setParseError(`Uploaded file "${f.name}" appears invalid or is missing a URL column. Please check the file and try again.`);
          }
        } else if (f.name.toLowerCase().endsWith('.json')) {
          try {
            const data = JSON.parse(text);
            if (Array.isArray(data)) {
              urls = data.map(row => row.url).filter(Boolean);
            } else if (data && typeof data === 'object') {
              // maybe an object with a list at a key like 'rows' or 'data'
              const arr = data.rows || data.data || null;
              if (Array.isArray(arr)) urls = arr.map(r => r.url).filter(Boolean);
            }
            if (!urls || urls.length === 0) {
              setUploadedFileName(null);
              setUploadedFile(null);
              setUploadedFileSize(null);
              setUploadedURLs([]);
              setParseError(`Uploaded JSON "${f.name}" did not contain any URL values. Please check the file and try again.`);
            }
          } catch (e) {
            // ignore parse errors, leave urls empty
            urls = [];
            setUploadedFileName(null);
            setUploadedFile(null);
            setUploadedFileSize(null);
            setUploadedURLs([]);
            setParseError(`Uploaded JSON "${f.name}" could not be parsed. Please check the file and try again.`);
          }
        }
        setUploadedURLs(urls);
        resolve(urls);
      };
      reader.readAsText(f);
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) processFile(f);
  }

  function removeUploadedFile(e) {
    e && e.stopPropagation();
    setUploadedFileName(null);
    setUploadedURLs([]);
    setUploadedFileSize(null);
    setUploadedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = null;
  }

  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined) return "-";
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const num = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    return `${num} ${sizes[i]}`;
  }

  async function runInference() {
    setProcessing(true);
    setOutput(null);
    setJobStatus({ status: 'starting', message: 'Initializing retrain...' });
    try {
      // If uploaded file exists but parsing hasn't completed, await it.
      if ((!uploadedURLs || uploadedURLs.length === 0) && uploadedFile) {
        // processFile returns a Promise that resolves with parsed URLs
        await processFile(uploadedFile);
      }

      // If no uploaded data, prompt user and emit console messages for a short time
      if (!uploadedURLs || uploadedURLs.length === 0) {
        console.warn("No file provided. Please upload a CSV/JSON with a 'url' column.");
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

      // Prepare request payload: use uploaded file urls
      let payload = null;
      if (uploadedURLs && uploadedURLs.length > 0) {
        payload = { urls: uploadedURLs };
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
      // Ensure the UI always shows the pseudonym the user entered and a consistent model version.
      const filtered = {
        meta: {
          // start with backend meta if present so we keep other fields, but override user_pseudonym and model_version
          ...(data.meta || {}),
          user_pseudonym: userId,
          timestamp: (data.meta && data.meta.timestamp) || new Date().toISOString(),
          model_version: "v0.1.1",
        },
        categories: (data.categories || [])
          .map((c) => ({
            ...c,
            likelihood: Number(c.likelihood.toFixed(2)),
            products: (c.products || []).map((p) => ({
              ...p,
              likelihood: Number(p.likelihood.toFixed(3)),
            })),
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
      {parseError && (
        <div style={{position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60}}>
          <div style={{background: 'white', padding: 24, borderRadius: 8, maxWidth: 520, width: '90%', boxShadow: '0 10px 30px rgba(0,0,0,0.25)'}}>
            <h3 style={{marginTop: 0}}>Invalid file</h3>
            <p style={{marginBottom: 16}}>{parseError}</p>
            <div style={{display: 'flex', justifyContent: 'flex-end'}}>
              <button onClick={() => setParseError(null)} style={{padding: '8px 12px', borderRadius: 6, border: 'none', background: '#2563eb', color: 'white'}}>OK</button>
            </div>
          </div>
        </div>
      )}
      <div className="dashboard-content">
        <header className="dashboard-header">
          <div className="header-title-group">
            <div className="header-icon">
              <img
                src="https://cdn.statically.io/img/registry.npmmirror.com/@lobehub/icons-static-png/1.74.0/files/dark/meta-color.png"
                alt="Meta logo"
                className="header-logo"
                loading="lazy"
              />
            </div>
            <div>
              <h1 className="header-title">Meta AdApt</h1>
              <p className="header-subtitle">
                Predict category & product-level ad engagement with
                explainability and export options.
              </p>
            </div>
          </div>
          <div className="header-model-info">
            <div className="model-info-text">
              {/* <div className="model-version">v0.1.1</div> */}
            </div>
            <button
              className="settings-button p-2 rounded-full bg-white/40 backdrop-blur-md shadow-md hover:shadow-lg hover:bg-white/60 transition-all duration-200"
              aria-label="Settings"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.8"
                stroke="currentColor"
                className="w-5 h-5 text-gray-600"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.944 3.31.823 2.366 2.366a1.724 1.724 0 001.065 2.573c1.757.426 1.757 2.924 0 3.35a1.724 1.724 0 00-1.065 2.573c.944 1.543-.823 3.31-2.366 2.366a1.724 1.724 0 00-2.573 1.065c-.426 1.757-2.924 1.757-3.35 0a1.724 1.724 0 00-2.573-1.065c-1.543.944-3.31-.823-2.366-2.366a1.724 1.724 0 00-1.065-2.573c-1.757-.426-1.757-2.924 0-3.35a1.724 1.724 0 001.065-2.573c-.944-1.543.823-3.31 2.366-2.366a1.724 1.724 0 002.573-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </header>

        <main className="main-grid">
          {/* Left panel: Inputs */}
          <section className="input-panel">
            <h2 className="panel-title">Input / Ingestion</h2>
            <p className="panel-description">
              Provide a browsing-history file.
            </p>

            <label className="form-label">User pseudonym</label>
            <input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="text-input"
            />

            <label className="form-label">Upload browsing history (JSON / CSV)</label>

            <div
              className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current && fileInputRef.current.click(); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,.csv,text/csv,application/json"
                onChange={handleFileUpload}
                className="file-input-hidden"
              />

              <div className="upload-placeholder">
                <div className="upload-icon">☁️</div>
                <div className="upload-text">
                  Drag & Drop your file here, or <span className="browse-link">browse</span>
                </div>
                <div className="upload-hint">Supported: .csv, .json</div>
              </div>

              {uploadedFileName ? (
                <div className="upload-info">
                  <div className="upload-name">{uploadedFileName}</div>
                  <div className="upload-meta">{formatBytes(uploadedFileSize)}</div>
                  <button className="remove-button" onClick={removeUploadedFile}>
                    Remove
                  </button>
                </div>
              ) : (
                <div className="file-status">No file selected</div>
              )}
            </div>

            {/* Inline sample removed — UI accepts uploaded CSV/JSON files only */}

            {/* Threshold is fixed to 0.05 by design; slider removed */}

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
                {processing ? (
                  "Processing…"
                ) : (
                  <>
                    <svg
                      className="run-icon"
                      viewBox="0 3 24 24"
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path d="M5 3v18l15-9L5 3z" fill="white" />
                    </svg>
                    <span>Run Prediction</span>
                  </>
                )}
              </button>
              {/* jobStatus is shown in the output panel placeholder; no duplicate needed here */}
              <button
                onClick={() => {
                  setOutput(null);
                  setUploadedFileName(null);
                  setUploadedURLs([]);
                  setUploadedFileSize(null);
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

            {/* Integration section removed (API key input) */}
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

                  {/* Nested Pie Chart Visualization */}
                  {output.categories && output.categories.length > 0 && (
                    <div style={{ marginBottom: "30px" }}>
                      <NestedPieChart categories={output.categories} />
                    </div>
                  )}

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
                                      {cat.products.map((p, i) => {
                                        const likelihoodNum = Number(p.likelihood) || 0;
                                        const pct = Math.round(likelihoodNum * 100);
                                        // ensure tiny non-zero probabilities are still visible
                                        const visiblePct = pct === 0 && likelihoodNum > 0 ? 1 : pct;
                                        return (
                                          <div key={`${idx}-${i}`} className="product-item">
                                            <div className="product-name">{p.name}</div>
                                            <div className="progress-bar-container">
                                              <div
                                                style={{
                                                  width: `${visiblePct}%`,
                                                  minWidth: likelihoodNum > 0 ? '2px' : '0',
                                                  transition: 'width .4s ease',
                                                }}
                                                className="progress-bar"
                                              />
                                            </div>
                                            <div className="product-likelihood">
                                              {pct}%
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                          </div>
                          <div className="category-actions">
                            <div className="actions-label">Actions</div>
                            <div className="action-buttons">
                              <button className="action-button">
                                Ex. Preview Creatives
                              </button>
                              <button className="action-button">
                                Ex. Create Segment
                              </button>
                              <button className="action-button">
                                Ex. Push to DSP
                              </button>
                            </div>
                          </div>
                        </div>
                        {explain && cat.explanation && (
                          <details className="explanation-details">
                            <summary className="explanation-summary">
                              Why this prediction? (To be updated)
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
                  (CSV includes per-product likelihoods and important keywords)
                </div>
              </div>
            </div>
          </section>
        </main>

        <footer className="dashboard-footer">
          Created for Meta Capstone Project - Not officially affiliated with Meta
        </footer>
      </div>
    </div>
  );
}