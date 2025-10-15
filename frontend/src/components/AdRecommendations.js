import React from "react";

const AdRecommendations = ({ ads }) => {
  if (!ads || ads.length === 0) return <p>No ads recommended yet</p>;

  return (
    <div>
      <h2>Ad Recommendations</h2>
      <ul>
        {ads.map((ad, i) => (
          <li key={i}>{ad}</li>
        ))}
      </ul>
    </div>
  );
};

export default AdRecommendations;
