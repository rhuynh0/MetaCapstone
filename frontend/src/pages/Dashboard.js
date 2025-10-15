import React, { useState } from "react";
import "./Dashboard.css";

export default function Dashboard() {
  const [uploadedFileName, setUploadedFileName] = useState(null);
  const [userId, setUserId] = useState("user_12345");
  const [output, setOutput] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [threshold, setThreshold] = useState(0.05);
  const [topK, setTopK] = useState(5);
  const [explain, setExplain] = useState(true);
  const [apiKey, setApiKey] = useState("");

  // Mock inference engine (client-side simulation)
  function mockPredict() {
    return {
      meta: {
        user_pseudonym: userId,
        timestamp: new Date().toISOString(),
        model_version: "v0.9.1-demo",
      },
      categories: [
        {
          name: "Electronics",
          likelihood: 0.68,
          products: [
            { name: "Laptop", likelihood: 0.45 },
            { name: "Wireless Earbuds", likelihood: 0.3 },
            { name: "Gaming Monitor", likelihood: 0.23 },
          ],
          explanation: [
            "recent visits to laptop comparison pages",
            "searches: best gaming monitor",
          ],
        },
        {
          name: "Travel",
          likelihood: 0.42,
          products: [
            { name: "Flights", likelihood: 0.28 },
            { name: "Hotels", likelihood: 0.25 },
            { name: "Rental Cars", likelihood: 0.19 },
          ],
          explanation: [
            "multiple hotel price lookups",
            "visited airline sites",
          ],
        },
        {
          name: "Fitness",
          likelihood: 0.35,
          products: [
            { name: "Running Shoes", likelihood: 0.2 },
            { name: "Smartwatch", likelihood: 0.1 },
            { name: "Yoga Mat", likelihood: 0.05 },
          ],
          explanation: [
            "viewed running shoe reviews",
            "searched: smartwatch features",
          ],
        },
      ],
    };
  }

  function handleFileUpload(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setUploadedFileName(f.name);
  }

  function runInference() {
    setProcessing(true);
    setOutput(null);
    setTimeout(() => {
      const raw = mockPredict();
      const filtered = {
        meta: raw.meta,
        categories: raw.categories
          .map((c) => ({ ...c, likelihood: Number(c.likelihood.toFixed(2)) }))
          .filter((c) => c.likelihood >= threshold)
          .slice(0, topK),
      };
      setOutput(filtered);
      setProcessing(false);
    }, 600);
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
              <button
                onClick={() => {
                  setOutput(null);
                  setUploadedFileName(null);
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
                  No predictions yet. Run a prediction to see results here.
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