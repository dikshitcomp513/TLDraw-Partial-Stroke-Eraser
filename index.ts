/**
 * @license MIT
 * tldraw-continuous-eraser
 *
 * A drop-in continuous vector eraser tool for tldraw v5+
 * Cuts, carves, and splits drawing strokes in real-time.
 */

export {
  ContinuousEraserTool,
  ContinuousEraserIdleState,
  ContinuousErasingState,
  STROKE_SIZES,
  encodeSegment,
  segmentsIntersect,
  isPieceValid,
  normalizePiece,
} from './ContinuousEraserTool';

export { ContinuousEraserTool as default } from './ContinuousEraserTool';
