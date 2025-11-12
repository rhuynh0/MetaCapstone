import React, { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const NestedPieChart = ({ categories }) => {
  const [activeIndex, setActiveIndex] = useState(null);

  // Color palette for the outer ring (categories)
  const COLORS = [
    "#3b82f6", // blue
    "#ef4444", // red
    "#10b981", // green
    "#f59e0b", // amber
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#06b6d4", // cyan
    "#14b8a6", // teal
    "#f97316", // orange
    "#6366f1", // indigo
  ];

  // Transform data for outer pie (categories)
  const outerData = categories.map((cat) => ({
    name: cat.name,
    value: parseFloat((cat.likelihood * 100).toFixed(1)),
    likelihood: cat.likelihood,
    products: cat.products || [],
  }));

  // Transform data for inner pie (products of selected category)
  const getInnerData = () => {
    if (activeIndex === null || !outerData[activeIndex]) {
      // Default: show all categories
      return outerData.map((cat, idx) => ({
        name: cat.name,
        value: cat.value,
        fill: COLORS[idx % COLORS.length],
      }));
    }

    const selected = outerData[activeIndex];
    return selected.products.map((product) => ({
      name: product.name,
      value: parseFloat((product.likelihood * 100).toFixed(1)),
      fill: COLORS[activeIndex % COLORS.length],
    }));
  };

  const innerData = getInnerData();

  // Custom label for outer pie
  const renderOuterLabel = (entry) => {
    return `${entry.value}%`;
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      return (
        <div
          style={{
            backgroundColor: "#fff",
            padding: "8px 12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
          }}
        >
          <p style={{ margin: 0, fontWeight: "bold" }}>{payload[0].name}</p>
          <p style={{ margin: 0, color: payload[0].fill }}>
            {payload[0].value}%
          </p>
        </div>
      );
    }
    return null;
  };

  const handleOuterClick = (data, index) => {
    setActiveIndex(activeIndex === index ? null : index);
  };

  return (
    <div
      style={{
        width: "100%",
        height: "500px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f9fafb",
        borderRadius: "8px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: "16px", color: "#111827" }}>
        {activeIndex !== null
          ? `${outerData[activeIndex].name} - Keywords Breakdown`
          : "Category Distribution"}
      </h3>

      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {/* Outer Pie - Categories */}
          <Pie
            data={outerData}
            cx="50%"
            cy="50%"
            outerRadius={120}
            innerRadius={60}
            paddingAngle={2}
            label={renderOuterLabel}
            dataKey="value"
            onClick={(_, index) => handleOuterClick(outerData[index], index)}
            onMouseEnter={(_, index) => {
              // Optional: highlight on hover
            }}
            style={{ cursor: "pointer" }}
          >
            {outerData.map((entry, index) => (
              <Cell
                key={`outer-${index}`}
                fill={COLORS[index % COLORS.length]}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.5}
                stroke={activeIndex === index ? "#000" : "none"}
                strokeWidth={activeIndex === index ? 2 : 0}
              />
            ))}
          </Pie>

          {/* Inner Pie - Products (if a category is selected) or mirrored categories */}
          <Pie
            data={innerData}
            cx="50%"
            cy="50%"
            outerRadius={55}
            innerRadius={15}
            paddingAngle={2}
            dataKey="value"
            label={({ value }) => `${value}%`}
          >
            {innerData.map((entry, index) => (
              <Cell key={`inner-${index}`} fill={entry.fill} />
            ))}
          </Pie>

          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            height={36}
            wrapperStyle={{ paddingTop: "20px" }}
          />
        </PieChart>
      </ResponsiveContainer>

      {activeIndex !== null && (
        <div style={{ marginTop: "16px", textAlign: "center" }}>
          <button
            onClick={() => setActiveIndex(null)}
            style={{
              padding: "8px 16px",
              backgroundColor: "#3b82f6",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Back to Categories
          </button>
        </div>
      )}

      <div
        style={{
          marginTop: "16px",
          fontSize: "12px",
          color: "#666",
          textAlign: "center",
        }}
      >
        {activeIndex !== null
          ? `Click "Back to Categories" or on a segment to navigate`
          : `Click on any category segment to see keyword breakdown`}
      </div>
    </div>
  );
};

export default NestedPieChart;
