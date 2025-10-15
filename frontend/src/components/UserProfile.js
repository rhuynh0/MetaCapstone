import React from "react";

const UserProfile = ({ profile }) => {
  if (!profile) return <p>No user profile loaded</p>;

  return (
    <div>
      <h2>User Profile</h2>
      <ul>
        {Object.entries(profile).map(([topic, value]) => (
          <li key={topic}>
            {topic}: {(value * 100).toFixed(1)}%
          </li>
        ))}
      </ul>
    </div>
  );
};

export default UserProfile;
