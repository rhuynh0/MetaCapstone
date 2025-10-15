import React from "react";

const ClusteringViz = ({ clusters }) => {
  if (!clusters) return <p>No clustering data</p>;

  return (
    <div>
      <h2>Clustering Visualization</h2>
      <p>{clusters.length} user clusters detected</p>
    </div>
  );
};

export default ClusteringViz;
