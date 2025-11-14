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
  const padding = 10;
  const outerRadius = 150;
  const innerRadius = 80;
  const width = outerRadius * 2 + padding * 2; // tight width ignoring labels
  const height = outerRadius * 2 + padding * 2; // tight height
  const centerX = width / 2;
  const centerY = height / 2;

  const polarToCartesian = (cx, cy, radius, angle) => {
    const rad = (angle - 90) * Math.PI / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad)
    };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Outer ring - Categories */}
          {chartData.map((cat, idx) => {
            const angle = (cat.likelihood / total) * 360;
            const startAngle = outerOffset;
            const endAngle = outerOffset + angle;
            outerOffset = endAngle;

            const midAngle = (startAngle + endAngle) / 2;
            // Place labels inside the ring so text length doesn't affect perceived centering
            const labelRadius = outerRadius - 18;
            const labelPos = polarToCartesian(centerX, centerY, labelRadius, midAngle);

            const outerStart = polarToCartesian(centerX, centerY, outerRadius, startAngle);
            const outerEnd = polarToCartesian(centerX, centerY, outerRadius, endAngle);
            const innerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
            const innerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
            const largeArc = angle > 180 ? 1 : 0;

            const isSelected = selectedCategory === idx;

            return (
              <g key={idx}>
                <path
                  d={`M ${outerStart.x} ${outerStart.y}
                      A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                      L ${innerEnd.x} ${innerEnd.y}
                      A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                      Z`}
                  fill={cat.color}
                  stroke="white"
                  strokeWidth="2"
                  opacity={selectedCategory === null || isSelected ? "0.9" : "0.4"}
                  style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                  onMouseEnter={(e) => e.target.style.opacity = '1'}
                  onMouseLeave={(e) => e.target.style.opacity = selectedCategory === null || isSelected ? '0.9' : '0.4'}
                  onClick={() => setSelectedCategory(idx)}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="600"
                  fill="#374151"
                  style={{ pointerEvents: 'none' }}
                >
                  {cat.name}
                </text>
                <text
                  x={labelPos.x}
                  y={labelPos.y + 12}
                  textAnchor="middle"
                  fontSize="9"
                  fill="#6b7280"
                  style={{ pointerEvents: 'none' }}
                >
                  {Math.round(cat.likelihood * 100)}%
                </text>
              </g>
            );
          })}

          {/* Inner ring - Products */}
          {selectedCategory !== null ? (
            // Show only selected category's products expanded to full 360°
            (() => {
              const cat = chartData[selectedCategory];
              const productTotal = cat.products.reduce((sum, p) => sum + p.likelihood, 0);
              let productOffset = 0;

              return cat.products.map((product, pIdx) => {
                const productAngle = (product.likelihood / productTotal) * 360;
                const startAngle = productOffset;
                const endAngle = startAngle + productAngle;
                productOffset = endAngle;

                const outerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
                const outerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
                const innerStart = polarToCartesian(centerX, centerY, 40, startAngle);
                const innerEnd = polarToCartesian(centerX, centerY, 40, endAngle);
                const largeArc = productAngle > 180 ? 1 : 0;

                return (
                  <g key={`selected-${pIdx}`}>
                    <path
                      d={`M ${outerStart.x} ${outerStart.y}
                          A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                          L ${innerEnd.x} ${innerEnd.y}
                          A 40 40 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                          Z`}
                      fill={cat.productColors[pIdx]}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    <title>{product.name}: {Math.round(product.likelihood * 100)}%</title>
                  </g>
                );
              });
            })()
          ) : (
            // Show all products from all categories
            chartData.map((cat, catIdx) => {
              const catAngle = (cat.likelihood / total) * 360;
              const catStart = chartData.slice(0, catIdx).reduce((sum, c) => sum + (c.likelihood / total) * 360, 0);
              
              const productTotal = cat.products.reduce((sum, p) => sum + p.likelihood, 0);
              let productOffset = 0;

              return cat.products.map((product, pIdx) => {
                const productAngle = (product.likelihood / productTotal) * catAngle;
                const startAngle = catStart + productOffset;
                const endAngle = startAngle + productAngle;
                productOffset += productAngle;

                const outerStart = polarToCartesian(centerX, centerY, innerRadius, startAngle);
                const outerEnd = polarToCartesian(centerX, centerY, innerRadius, endAngle);
                const innerStart = polarToCartesian(centerX, centerY, 40, startAngle);
                const innerEnd = polarToCartesian(centerX, centerY, 40, endAngle);
                const largeArc = productAngle > 180 ? 1 : 0;

                return (
                  <g key={`${catIdx}-${pIdx}`}>
                    <path
                      d={`M ${outerStart.x} ${outerStart.y}
                          A ${innerRadius} ${innerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}
                          L ${innerEnd.x} ${innerEnd.y}
                          A 40 40 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}
                          Z`}
                      fill={cat.productColors[pIdx]}
                      stroke="white"
                      strokeWidth="1.5"
                    />
                    <title>{product.name}: {Math.round(product.likelihood * 100)}%</title>
                  </g>
                );
              });
            })
          )}

          {/* Center circle */
          }
          <circle
            cx={centerX}
            cy={centerY}
            r="38"
            fill="white"
            stroke="#e5e7eb"
            strokeWidth="2"
          />
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
