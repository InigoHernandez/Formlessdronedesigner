// Analyzes drawing strokes to extract musical properties for FORMLESS

export interface Point {
  x: number;
  y: number;
  time: number;
}

export interface AnalyzedStroke {
  points: Point[];
  speed: number;
  length: number;
  duration: number;
  curvature: number; // renamed from complexity
  avgY: number; // average vertical position
  startPoint: { x: number; y: number };
}

export class StrokeAnalyzer {
  static analyze(points: Point[]): AnalyzedStroke {
    if (points.length < 2) {
      return {
        points,
        speed: 0,
        length: 0,
        duration: 0,
        curvature: 0,
        avgY: points[0]?.y || 0,
        startPoint: points[0] || { x: 0, y: 0 },
      };
    }

    const length = this.calculateLength(points);
    const duration = (points[points.length - 1].time - points[0].time) / 1000;
    const speed = duration > 0 ? length / duration : 0;
    const curvature = this.calculateCurvature(points);
    const avgY = this.calculateAverageY(points);

    return {
      points,
      speed,
      length,
      duration,
      curvature,
      avgY,
      startPoint: { x: points[0].x, y: points[0].y },
    };
  }

  private static calculateLength(points: Point[]): number {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dy = points[i].y - points[i - 1].y;
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  private static calculateCurvature(points: Point[]): number {
    // Measure how much the direction changes (more changes = more curved)
    if (points.length < 3) return 0;

    let totalAngleChange = 0;
    for (let i = 1; i < points.length - 1; i++) {
      const angle1 = Math.atan2(
        points[i].y - points[i - 1].y,
        points[i].x - points[i - 1].x
      );
      const angle2 = Math.atan2(
        points[i + 1].y - points[i].y,
        points[i + 1].x - points[i].x
      );
      let diff = Math.abs(angle2 - angle1);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      totalAngleChange += diff;
    }

    // Normalize to 0-1 range
    const maxChange = (points.length - 2) * Math.PI;
    return Math.min(totalAngleChange / maxChange, 1);
  }

  private static calculateAverageY(points: Point[]): number {
    const sum = points.reduce((acc, p) => acc + p.y, 0);
    return sum / points.length;
  }
}