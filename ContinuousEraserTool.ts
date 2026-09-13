/**
 * @license MIT
 * Continuous Vector Eraser Tool for tldraw v5+
 *
 * Slices, carves, and trims vector ink strokes in real-time
 * instead of deleting the entire stroke at once.
 */

import {
  StateNode,
  type TLStateNodeConstructor,
  type TLPointerEventInfo,
  type TLDrawShape,
  type TLDrawShapeSegment,
  type TLShapePartial,
  type TLShapeId,
  Vec,
  b64Vecs,
  createShapeId,
  Box,
} from 'tldraw';

/**
 * Standard brush stroke widths by size key in TLDraw.
 */
export const STROKE_SIZES: Record<string, number> = {
  s: 2,
  m: 3.5,
  l: 5,
  xl: 10,
};

/**
 * Encodes decoded Vec[] points back into a valid TLDrawShapeSegment.
 */
export function encodeSegment(
  type: TLDrawShapeSegment['type'],
  points: Vec[],
  dim?: 2
): TLDrawShapeSegment {
  const path = b64Vecs.encodePoints(points, dim);
  return dim === 2 ? { type, path, dim: 2 } : { type, path };
}

/**
 * Checks if two 2D line segments [a1, a2] and [b1, b2] intersect.
 */
export function segmentsIntersect(a1: Vec, a2: Vec, b1: Vec, b2: Vec): boolean {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;

  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-8) return false;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;

  const t = (dx * d2y - dy * d2x) / cross;
  const u = (dx * d1y - dy * d1x) / cross;

  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/**
 * Determines whether a surviving piece of a stroke is physically substantial enough
 * to keep, or if it is an orphaned speck/sliver that should be culled.
 *
 * Evaluates both total cumulative arc-length along the curve and diagonal bounding span.
 */
export function isPieceValid(points: Vec[], minLength: number): boolean {
  if (points.length < 2) return false;

  let arcLength = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;

    if (i < points.length - 1) {
      arcLength += Vec.Dist(pt, points[i + 1]);
    }
  }

  const span = Math.hypot(maxX - minX, maxY - minY);
  return arcLength >= minLength || span >= minLength;
}

/**
 * Normalizes a surviving stroke piece so that its minimum bounding corner (minX, minY)
 * becomes local (0, 0) and computes the exact new (x, y) coordinates in parent space.
 *
 * Why this is critical:
 * TLDraw calculates shape bounding boxes and dot geometry relative to local (0, 0).
 * If surviving vertices are not normalized to (0, 0), the selection box and click hit-testing
 * will jump to the start point of the original stroke.
 */
export function normalizePiece(
  piece: { type: TLDrawShapeSegment['type']; dim?: 2; points: Vec[] },
  shapeX: number,
  shapeY: number,
  rotation: number
) {
  let minX = Infinity;
  let minY = Infinity;
  for (const pt of piece.points) {
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
  }

  // Calculate rotated offset in parent space
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const rotatedMinX = minX * cos - minY * sin;
  const rotatedMinY = minX * sin + minY * cos;
  const newX = shapeX + rotatedMinX;
  const newY = shapeY + rotatedMinY;

  // Offset all points so that (minX, minY) maps directly to local (0, 0)
  const normalizedPoints = piece.points.map(
    (pt) => new Vec(pt.x - minX, pt.y - minY, pt.z)
  );

  return {
    x: newX,
    y: newY,
    points: normalizedPoints,
    type: piece.type,
    dim: piece.dim,
  };
}

/**
 * Continuous Erasing State.
 * Active while the user drags across strokes with the eraser tool.
 */
export class ContinuousErasingState extends StateNode {
  static override id = 'erasing';

  private markId: string | null = null;
  private scribbleId: string = 'continuous-eraser-scribble';

  override onEnter(info: TLPointerEventInfo) {
    this.markId = this.editor.markHistoryStoppingPoint('continuous erase start');

    const scribble = this.editor.scribbles.addScribble({
      color: 'muted-1',
      size: 14,
    });
    this.scribbleId = scribble.id;

    this.eraseAtCurrentPoint();
  }

  override onPointerMove() {
    this.eraseAtCurrentPoint();
  }

  override onPointerUp() {
    this.complete();
  }

  override onCancel() {
    if (this.markId) {
      this.editor.bailToMark(this.markId);
    }
    this.parent.transition('idle');
  }

  override onExit() {
    this.editor.scribbles.stop(this.scribbleId);
  }

  private complete() {
    this.parent.transition('idle');
  }

  private eraseAtCurrentPoint() {
    const editor = this.editor;
    const inputs = editor.inputs;
    const currentPagePoint = inputs.getCurrentPagePoint();
    const previousPagePoint = inputs.getPreviousPagePoint();

    // Visual feedback trail using TLDraw scribbles
    editor.scribbles.addPoint(this.scribbleId, currentPagePoint.x, currentPagePoint.y);

    const zoom = editor.getZoomLevel();
    // 14 screen pixels converted to canvas page space
    const eraseRadius = 14 / zoom;
    const eraseBounds = Box.FromPoints([previousPagePoint, currentPagePoint]).expandBy(eraseRadius);

    const candidateIds = editor.getShapeIdsInsideBounds(eraseBounds);
    if (candidateIds.size === 0) return;

    const shapesToUpdate: TLShapePartial<TLDrawShape>[] = [];
    const shapesToDelete: TLShapeId[] = [];
    const shapesToCreate: TLShapePartial<TLDrawShape>[] = [];

    for (const id of candidateIds) {
      const shape = editor.getShape(id);
      if (!shape || (shape.type !== 'draw' && shape.type !== 'highlight')) continue;

      const drawShape = shape as TLDrawShape;
      const transform = editor.getShapePageTransform(drawShape);
      if (!transform) continue;

      const invTransform = transform.clone().invert();
      const localCurrentPoint = invTransform.applyToPoint(currentPagePoint);
      const localPreviousPoint = invTransform.applyToPoint(previousPagePoint);

      const segments = drawShape.props.segments;
      let shapeModified = false;

      const baseWidth = STROKE_SIZES[drawShape.props.size] ?? 3.5;
      const effectiveWidth = baseWidth * (drawShape.props.scale ?? 1);
      // Fragments shorter than 1.8x the stroke diameter or under 6px are pruned as specks
      const minPieceLength = Math.max(6, effectiveWidth * 1.8);

      // Collect all surviving contiguous sub-strokes across all segments
      const allSurvivingPieces: {
        type: TLDrawShapeSegment['type'];
        dim?: 2;
        points: Vec[];
      }[] = [];

      for (const segment of segments) {
        const segDim: 2 | undefined = segment.dim === 2 ? 2 : undefined;
        const decodedPoints = b64Vecs.decodePoints(segment.path, segDim);
        if (decodedPoints.length === 0) continue;

        let currentPiece: Vec[] = [];

        for (let i = 0; i < decodedPoints.length; i++) {
          const pt = decodedPoints[i];
          const ptVec = new Vec(pt.x, pt.y);

          // Distance from this point to the eraser stroke segment
          const dist = Vec.DistanceToLineSegment(localPreviousPoint, localCurrentPoint, ptVec);
          const isPtErased = dist <= eraseRadius;

          // Check if eraser segment crosses between pt[i] and pt[i+1]
          let crossesStroke = false;
          if (i < decodedPoints.length - 1) {
            const nextPt = decodedPoints[i + 1];
            const nextPtVec = new Vec(nextPt.x, nextPt.y);
            crossesStroke = segmentsIntersect(localPreviousPoint, localCurrentPoint, ptVec, nextPtVec);
          }

          if (isPtErased) {
            shapeModified = true;
            // Prune if fragment does not satisfy minimum physical length / span
            if (isPieceValid(currentPiece, minPieceLength)) {
              allSurvivingPieces.push({
                type: segment.type,
                dim: segDim,
                points: currentPiece,
              });
            }
            currentPiece = [];
          } else {
            currentPiece.push(new Vec(pt.x, pt.y, pt.z ?? 0.5));
            if (crossesStroke) {
              shapeModified = true;
              // Prune if fragment does not satisfy minimum physical length / span
              if (isPieceValid(currentPiece, minPieceLength)) {
                allSurvivingPieces.push({
                  type: segment.type,
                  dim: segDim,
                  points: currentPiece,
                });
              }
              currentPiece = [];
            }
          }
        }

        // Prune if final fragment does not satisfy minimum physical length / span
        if (isPieceValid(currentPiece, minPieceLength)) {
          allSurvivingPieces.push({
            type: segment.type,
            dim: segDim,
            points: currentPiece,
          });
        } else if (currentPiece.length > 0) {
          shapeModified = true;
        }
      }

      if (shapeModified) {
        if (allSurvivingPieces.length === 0) {
          // Entire stroke erased
          shapesToDelete.push(drawShape.id);
        } else {
          // The first remaining piece updates the original shape with normalized local coordinates
          const normalizedFirstPiece = normalizePiece(
            allSurvivingPieces[0],
            drawShape.x,
            drawShape.y,
            drawShape.rotation
          );

          shapesToUpdate.push({
            id: drawShape.id,
            type: drawShape.type,
            x: normalizedFirstPiece.x,
            y: normalizedFirstPiece.y,
            props: {
              segments: [
                encodeSegment(
                  normalizedFirstPiece.type,
                  normalizedFirstPiece.points,
                  normalizedFirstPiece.dim
                ),
              ],
            },
          });

          // Any additional severed pieces MUST be created as separate normalized shapes.
          // Normalizing coordinates ensures their bounding boxes and selection outlines are
          // centered precisely around the visible stroke rather than jumping to original start coordinates.
          for (let p = 1; p < allSurvivingPieces.length; p++) {
            const normalizedExtraPiece = normalizePiece(
              allSurvivingPieces[p],
              drawShape.x,
              drawShape.y,
              drawShape.rotation
            );

            shapesToCreate.push({
              id: createShapeId(),
              type: drawShape.type,
              parentId: drawShape.parentId,
              index: drawShape.index,
              x: normalizedExtraPiece.x,
              y: normalizedExtraPiece.y,
              rotation: drawShape.rotation,
              opacity: drawShape.opacity,
              isLocked: drawShape.isLocked,
              props: {
                ...drawShape.props,
                segments: [
                  encodeSegment(
                    normalizedExtraPiece.type,
                    normalizedExtraPiece.points,
                    normalizedExtraPiece.dim
                  ),
                ],
              },
            });
          }
        }
      }
    }

    if (shapesToDelete.length > 0 || shapesToUpdate.length > 0 || shapesToCreate.length > 0) {
      editor.run(() => {
        if (shapesToDelete.length > 0) {
          editor.deleteShapes(shapesToDelete);
        }
        if (shapesToUpdate.length > 0) {
          editor.updateShapes(shapesToUpdate);
        }
        if (shapesToCreate.length > 0) {
          editor.createShapes(shapesToCreate);
        }
      });
    }
  }
}

/**
 * Idle State for the continuous eraser tool.
 */
export class ContinuousEraserIdleState extends StateNode {
  static override id = 'idle';

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('erasing', info);
  }
}

/**
 * ContinuousEraserTool:
 * Slices and cuts continuous strokes in real-time vector coordinates
 * rather than removing the entire stroke at once.
 */
export class ContinuousEraserTool extends StateNode {
  static override id = 'continuous-eraser';
  static override initial = 'idle';
  static override isLockable = false;

  static override children(): TLStateNodeConstructor[] {
    return [ContinuousEraserIdleState, ContinuousErasingState];
  }

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 });
  }
}

export default ContinuousEraserTool;
