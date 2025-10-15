import React, { useState } from "react";
import DataUpload from "../components/DataUpload";
import UserProfile from "../components/UserProfile";
import AdRecommendations from "../components/AdRecommendations";
import ClusteringViz from "../components/ClusteringViz";

const Dashboard = () => {
  const [userProfile, setUserProfile] = useState(null);
  const [ads, setAds] = useState([]);
  const [clusters, setClusters] = useState([]);

  const handleDataUpload = (data) => {
    // Placeholder: send data to backend ML API later
    console.log("Data uploaded:", data);

    // Example simulated outputs
    setUserProfile({ tech: 0.5, travel: 0.3, shopping: 0.2 });
    setAds(["Laptop Ads", "Travel Deals", "Shopping Coupons"]);
    setClusters([1, 2, 1, 3]);
  };

  return (
    <div>
      <h1>Browser History Analysis Dashboard</h1>
      <DataUpload onDataUpload={handleDataUpload} />
      <UserProfile profile={userProfile} />
      <AdRecommendations ads={ads} />
      <ClusteringViz clusters={clusters} />
    </div>
  );
};

export default Dashboard;
