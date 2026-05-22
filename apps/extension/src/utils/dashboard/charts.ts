import type { ChartPoint } from "../../components/dashboard/types";

export const buildSmoothPath = (points: ChartPoint[]): string => {
  if (points.length === 0) {
    return "";
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  return points.slice(1).reduce((path, point, index) => {
    const previousPoint = points[index];
    const controlOffset = (point.x - previousPoint.x) / 2;

    return `${path} C ${previousPoint.x + controlOffset} ${previousPoint.y}, ${point.x - controlOffset} ${
      point.y
    }, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
};
