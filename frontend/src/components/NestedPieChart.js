import React, { useState, useMemo } from "react";

export default function NestedPieChart({ categories }) {
  const [selectedCategory, setSelectedCategory] = useState(null);

  const chartData = useMemo(() => {
    const colors = [
      '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
      '#06b6d4', '#6366f1', '#f43f5e', '#84cc16', '#14b8a6'
    ];
    
    return categories.map((cat, idx) => ({
      ...cat,
      color: colors[idx % colors.length],
      productColors: cat.products.map((_, pIdx) => {
        const baseColor = colors[idx % colors.length];
        const opacity = 0.4 + (0.6 * (pIdx / Math.max(cat.products.length - 1, 1)));
        return baseColor + Math.round(opacity * 255).toString(16).padStart(2, '0');
      })
    }));
  }, [categories]);

  const total = chartData.reduce((sum, cat) => sum + cat.likelihood, 0);
  let outerOffset = 0;

  // Use a tight SVG canvas so visual center is consistent
  const padding = 28; // extra room so labels aren't clipped
  const outerRadius = 190; // enlarged for readability
  const innerRadius = 120; // enlarged inner ring outer radius
  const innerInnerRadius = innerRadius - 40; // keep ring thickness ≈ 40px
  const width = outerRadius * 2 + padding * 2; // tight width ignoring labels
  const height = outerRadius * 2 + padding * 2; // tight height
  const centerX = width / 2;
  const centerY = height / 2;
  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  const polarToCartesian = (cx, cy, radius, angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  // Calculate label positions with collision avoidance (force-directed layout)
  const labelPositions = useMemo(() => {
    let angleOffset = 0;
    const positions = chartData.map((cat, idx) => {
      const angle = (cat.likelihood / total) * 360;
      const midAngle = angleOffset + angle / 2;
      angleOffset += angle;
      
      const labelRadius = outerRadius + 25; // balanced distance - closer but with spacing
      const initialPos = polarToCartesian(centerX, centerY, labelRadius, midAngle);
      
      return {
        idx,
        initialPos,
        midAngle,
        angle,
        boxWidth: Math.max(cat.name.length * 6 + 32, Math.round(cat.likelihood * 100).toString().length * 8 + 32),
        boxHeight: 36
      };
    });

    return positions;
  }, [chartData, total, centerX, centerY, outerRadius]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ overflow: 'visible' }}
        >
          {/* Outer ring - Categories (just the segments, no labels yet) */}
          {chartData.map((cat, idx) => {
            const angle = (cat.likelihood / total) * 360;
            const startAngle = outerOffset;
            const endAngle = outerOffset + angle;
            outerOffset = endAngle;

            const isSelected = selectedCategory === idx;
            
            // Scale radii outward when selected (creates expanding effect)
            const popOutScale = isSelected ? 1.15 : 1.0;
            const expandedOuterRadius = outerRadius * popOutScale;
            const expandedInnerRadius = innerRadius * popOutScale;

            const outerStart = polarToCartesian(centerX, centerY, expandedOuterRadius, startAngle);
            const outerEnd = polarToCartesian(centerX, centerY, expandedOuterRadius, endAngle);
            const innerStart = polarToCartesian(centerX, centerY, expandedInnerRadius, startAngle);
            const innerEnd = polarToCartesian(centerX, centerY, expandedInnerRadius, endAngle);
            const largeArc = angle > 180 ? 1 : 0;

            return (
              <path
                key={`segment-${idx}`}
                d={`M ${outerStart.x} ${outerStart.y}
                    A ${expandedOuterRadius} ${expandedOuterRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                    L ${innerEnd.x} ${innerEnd.y}
                    A ${expandedInnerRadius} ${expandedInnerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                    Z`}
                fill={cat.color}
                stroke="white"
                strokeWidth="2"
                opacity={selectedCategory === null || isSelected ? "0.9" : "0.4"}
                style={{ 
                  cursor: 'pointer', 
                  transition: 'all 0.3s ease',
                  transformOrigin: `${centerX}px ${centerY}px`
                }}
                onMouseEnter={(e) => e.target.style.opacity = '1'}
                onMouseLeave={(e) => e.target.style.opacity = selectedCategory === null || isSelected ? '0.9' : '0.4'}
                onClick={() => setSelectedCategory(idx)}
              />
            );
          })}

          {/* Inner ring - Products */}
          {selectedCategory !== null ? (
            (() => {
              const cat = chartData[selectedCategory];
              const productTotal = cat.products.reduce((sum, p) => sum + p.likelihood, 0);
              if (!productTotal || cat.products.length === 1) {
                const r = (innerRadius + innerInnerRadius) / 2;
                const sw = innerRadius - innerInnerRadius;
                const only = cat.products[0] || { name: 'N/A', likelihood: 0 };
                const denom = productTotal || (only.likelihood || 1);
                const pct = Math.round((only.likelihood / denom) * 100);
                return (
                  <g key={`selected-single`}>
                    <circle cx={centerX} cy={centerY} r={r} fill="none" stroke={cat.productColors[0] || cat.color} strokeWidth={sw}>
                      <title>{only.name}: {pct}%</title>
                    </circle>
                  </g>
                );
              }
              let productOffset = 0;
              return cat.products.map((product, pIdx) => {
                const val = product.likelihood || 0;
                if (val <= 0) return null;
                let productAngle = (val / productTotal) * 360;
                if (productAngle >= 360) productAngle = 359.999;
                if (productAngle <= 0.01) return null;
                const startAngle = productOffset;
                const endAngle = startAngle + productAngle;
                productOffset = endAngle;
                const outerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
                const outerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
                const innerStart = polarToCartesian(centerX, centerY, innerInnerRadius, startAngle);
                const innerEnd = polarToCartesian(centerX, centerY, innerInnerRadius, endAngle);
                const largeArc = productAngle > 180 ? 1 : 0;
                return (
                  <g key={`selected-${pIdx}`}>
                    <path
                      d={`M ${outerStart.x} ${outerStart.y}
                          A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                          L ${innerEnd.x} ${innerEnd.y}
                          A ${innerInnerRadius} ${innerInnerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                          Z`}
                      fill={cat.productColors[pIdx]}
                      stroke="none"
                    />
                    <title>{product.name}: {Math.round(val * 100)}%</title>
                  </g>
                );
              });
            })()
          ) : (
            chartData.map((cat, catIdx) => {
              const catAngle = (cat.likelihood / total) * 360;
              const catStart = chartData.slice(0, catIdx).reduce((sum, c) => sum + (c.likelihood / total) * 360, 0);
              const productTotal = cat.products.reduce((sum, p) => sum + p.likelihood, 0);
              let productOffset = 0;
              return cat.products.map((product, pIdx) => {
                const val = product.likelihood || 0;
                if (val <= 0) return null;
                let productAngle = (val / productTotal) * catAngle;
                if (productAngle <= 0.01) return null;
                const startAngle = catStart + productOffset;
                const endAngle = startAngle + productAngle;
                productOffset += productAngle;
                const outerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
                const outerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
                const innerStart = polarToCartesian(centerX, centerY, innerInnerRadius, startAngle);
                const innerEnd = polarToCartesian(centerX, centerY, innerInnerRadius, endAngle);
                const largeArc = productAngle > 180 ? 1 : 0;
                return (
                  <g key={`${catIdx}-${pIdx}`}>
                    <path
                      d={`M ${outerStart.x} ${outerStart.y}
                          A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                          L ${innerEnd.x} ${innerEnd.y}
                          A ${innerInnerRadius} ${innerInnerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                          Z`}
                      fill={cat.productColors[pIdx]}
                      stroke="none"
                    />
                    <title>{product.name}: {Math.round(val * 100)}%</title>
                  </g>
                );
              });
            })
          )}

          {/* Center circle */}
          <circle
            cx={centerX}
            cy={centerY}
            r={innerInnerRadius - 1}
            fill={isDark ? '#111827' : 'white'}
            stroke="none"
          />
          {/* Center label when drilling down */}
          {selectedCategory !== null && chartData[selectedCategory] && (
            (() => {
              const cat = chartData[selectedCategory];
              const name = (cat.name || '').length > 16 ? `${cat.name.slice(0, 15)}…` : cat.name;
              const pct = Math.round((cat.likelihood || 0) * 100);
              return (
                <g key="center-label">
                  <text
                    x={centerX}
                    y={centerY - 2}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="700"
                    fill={isDark ? '#F9FAFB' : '#111827'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {name}
                  </text>
                  <text
                    x={centerX}
                    y={centerY + 12}
                    textAnchor="middle"
                    fontSize="11"
                    fill={isDark ? '#E5E7EB' : '#6b7280'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {pct}%
                  </text>
                </g>
              );
            })()
          )}

          {/* Category labels and boxes - rendered last so they appear on top */}
          {labelPositions.map((labelInfo) => {
            const isSelected = selectedCategory === labelInfo.idx;
            // Only show labels when no category is selected, OR show the selected category's label
            if (selectedCategory !== null && !isSelected) return null;
            
            const cat = chartData[labelInfo.idx];
            const labelPos = labelInfo.initialPos;
            const boxWidth = labelInfo.boxWidth;
            const boxHeight = labelInfo.boxHeight;

            return (
              <g key={`label-${labelInfo.idx}`}>
                {/* Light blue background box for label readability - dynamically sized */}
                <rect
                  x={labelPos.x - boxWidth / 2}
                  y={labelPos.y - boxHeight / 2}
                  width={boxWidth}
                  height={boxHeight}
                  fill="#dbeafe"
                  stroke="#93c5fd"
                  strokeWidth="1"
                  rx="4"
                  opacity="0.95"
                  style={{ pointerEvents: 'none' }}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight="600"
                  fill="#1f2937"
                  style={{ pointerEvents: 'none' }}
                >
                  {cat.name}
                </text>
                <text
                  x={labelPos.x}
                  y={labelPos.y + 12}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#6b7280"
                  style={{ pointerEvents: 'none' }}
                >
                  {Math.round(cat.likelihood * 100)}%
                </text>
              </g>
            );
          })}

          {/* Product labels in inner ring (when a category is selected) */}
          {selectedCategory !== null && chartData[selectedCategory] && (
            (() => {
              const cat = chartData[selectedCategory];
              const productTotal = cat.products.reduce((sum, p) => sum + p.likelihood, 0);
              if (!productTotal || cat.products.length === 1) return null;
              
              let productOffset = 0;
              return cat.products.map((product, pIdx) => {
                const val = product.likelihood || 0;
                if (val <= 0) return null;
                let productAngle = (val / productTotal) * 360;
                if (productAngle <= 0.01) return null;
                
                const startAngle = productOffset;
                const endAngle = startAngle + productAngle;
                productOffset = endAngle;
                
                const midAngle = (startAngle + endAngle) / 2;
                const labelRadius = (innerRadius + innerInnerRadius) / 2;
                const labelPos = polarToCartesian(centerX, centerY, labelRadius, midAngle);
                
                return (
                  <g key={`product-label-${pIdx}`}>
                    <text
                      x={labelPos.x}
                      y={labelPos.y}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight="600"
                      fill="#ffffff"
                      stroke="#000000"
                      strokeWidth="1"
                      style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                    >
                      {product.name}
                    </text>
                    <text
                      x={labelPos.x}
                      y={labelPos.y + 10}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#ffffff"
                      stroke="#000000"
                      strokeWidth="0.8"
                      style={{ pointerEvents: 'none', paintOrder: 'stroke' }}
                    >
                      {Math.round(val * 100)}%
                    </text>
                  </g>
                );
              });
            })()
          )}
        </svg>
      </div>
      {selectedCategory !== null && (
        <div style={{ marginTop: '1rem' }}>
          <button
            onClick={() => setSelectedCategory(null)}
            style={{
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            }}
          >
            ← Reset View
          </button>
        </div>
      )}
    </div>
  );
}
