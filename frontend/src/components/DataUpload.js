import React, { useState } from "react";

const DataUpload = ({ onDataUpload }) => {
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = () => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      onDataUpload(text);
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <input type="file" accept=".csv,.json" onChange={handleFileChange} />
      <button onClick={handleUpload}>Upload</button>
    </div>
  );
};

export default DataUpload;
