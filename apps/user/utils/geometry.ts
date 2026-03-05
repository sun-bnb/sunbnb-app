interface InventoryItem {
  locationLat: number;
  locationLng: number;
}

// Define a simple Point interface.
interface Point {
  lat: number;
  lng: number;
}

// Convert InventoryItem[] to Point[].
function itemsToPoints(items: InventoryItem[]): Point[] {
  return items.map(item => ({
    lat: Number(item.locationLat),
    lng: Number(item.locationLng)
  }));
}

// Compute the cross product (for convex hull).
function cross(o: Point, a: Point, b: Point): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

// Compute the convex hull using the monotone chain algorithm.
function convexHull(points: Point[]): Point[] {
  if (points.length <= 1) return points.slice();
  const sorted = points.slice().sort((a, b) =>
    a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng
  );
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  // Remove duplicate endpoints.
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Ramer-Douglas-Peucker algorithm to simplify a polygon.
function simplifyPolygon(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  let index = -1;
  let maxDist = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, firstPoint, lastPoint);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyPolygon(points.slice(0, index + 1), tolerance);
    const right = simplifyPolygon(points.slice(index), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [firstPoint, lastPoint];
  }
}

// Compute the perpendicular distance from point p to line p1->p2.
function perpendicularDistance(p: Point, p1: Point, p2: Point): number {
  const numerator = Math.abs((p2.lng - p1.lng) * (p1.lat - p.lat) - (p1.lng - p.lng) * (p2.lat - p1.lat));
  const denominator = Math.sqrt(Math.pow(p2.lng - p1.lng, 2) + Math.pow(p2.lat - p1.lat, 2));
  return denominator === 0 ? 0 : numerator / denominator;
}

// Compute the minimum bounding rectangle (rotating calipers) as a fallback.
function minimumBoundingRectangle(hull: Point[]): Point[] {
  if (hull.length === 0) return [];
  let minArea = Infinity;
  let bestRectangle: Point[] = [];
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const p1 = hull[i]!;
    const p2 = hull[(i + 1) % n]!;
    const angle = Math.atan2(p2.lat - p1.lat, p2.lng - p1.lng);
    const rotated = hull.map(p => rotatePoint(p, -angle));
    const xs = rotated.map(p => p.lng);
    const ys = rotated.map(p => p.lat);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const area = (maxX - minX) * (maxY - minY);
    if (area < minArea) {
      minArea = area;
      const rectRotated: Point[] = [
        { lat: minY, lng: minX },
        { lat: minY, lng: maxX },
        { lat: maxY, lng: maxX },
        { lat: maxY, lng: minX },
      ];
      bestRectangle = rectRotated.map(p => rotatePoint(p, angle));
    }
  }
  return bestRectangle;
}

// Rotate a point by a given angle (radians) about the origin.
function rotatePoint(p: Point, angle: number): Point {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    lat: p.lat * cos - p.lng * sin,
    lng: p.lat * sin + p.lng * cos
  };
}

/**
 * Compute a quadragon (4-vertex polygon) that approximates the parcel formed by items.
 * First, compute the convex hull.
 * If the hull has 4 vertices, return it.
 * Otherwise, try to simplify the hull to 4 vertices.
 * If that fails, fall back to the minimum bounding rectangle.
 */
export function getQuadragonEdges(items: InventoryItem[]): Point[] {
  const points = itemsToPoints(items);
  const hull = convexHull(points);
  if (hull.length === 4) {
    return hull;
  }
  // Try simplifying the hull to 4 points.
  let tolerance = 0.00005; // initial tolerance (adjust as needed)
  let simplified = simplifyPolygon(hull, tolerance);
  // Increase tolerance until we get 4 vertices, or break if tolerance becomes too high.
  while (simplified.length !== 4 && tolerance < 0.001) {
    tolerance *= 2;
    simplified = simplifyPolygon(hull, tolerance);
  }
  if (simplified.length === 4) {
    return simplified;
  }
  // Fallback: use the minimum bounding rectangle.
  return minimumBoundingRectangle(hull);
}

/**
 * Compute a padded convex hull that follows the actual shape of the parcel.
 * The padding is specified in meters and adds a buffer around the outermost sunbed positions
 * so the polygon visually wraps the markers rather than cutting through their centres.
 */
export function getPaddedConvexHull(items: InventoryItem[], paddingMeters: number = 2): Point[] {
  const points = itemsToPoints(items);
  if (points.length === 0) return [];
  if (points.length === 1) {
    // Single point — create a small diamond
    const p = points[0]!;
    const dLat = paddingMeters / 111320;
    const dLng = paddingMeters / (111320 * Math.cos(p.lat * Math.PI / 180));
    return [
      { lat: p.lat + dLat, lng: p.lng },
      { lat: p.lat, lng: p.lng + dLng },
      { lat: p.lat - dLat, lng: p.lng },
      { lat: p.lat, lng: p.lng - dLng },
    ];
  }

  const hull = convexHull(points);
  if (hull.length < 2) return hull;

  // Compute centroid for outward direction
  let cLat = 0, cLng = 0;
  for (const p of hull) { cLat += p.lat; cLng += p.lng; }
  cLat /= hull.length;
  cLng /= hull.length;

  const metersPerLat = 111320;
  const metersPerLng = 111320 * Math.cos(cLat * Math.PI / 180);

  // Expand each hull vertex outward from centroid by paddingMeters
  const padded: Point[] = hull.map(p => {
    const dx = (p.lng - cLng) * metersPerLng;
    const dy = (p.lat - cLat) * metersPerLat;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) return p;
    const scale = (dist + paddingMeters) / dist;
    return {
      lat: cLat + (p.lat - cLat) * scale,
      lng: cLng + (p.lng - cLng) * scale,
    };
  });

  // Smooth by inserting midpoints for a rounder appearance (one pass)
  if (padded.length >= 3) {
    const smoothed: Point[] = [];
    for (let i = 0; i < padded.length; i++) {
      const curr = padded[i]!;
      const next = padded[(i + 1) % padded.length]!;
      smoothed.push(curr);
      smoothed.push({ lat: (curr.lat + next.lat) / 2, lng: (curr.lng + next.lng) / 2 });
    }
    return smoothed;
  }

  return padded;
}

