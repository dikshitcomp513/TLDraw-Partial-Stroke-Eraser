# 🧹 tldraw-continuous-eraser

> A high-performance, pixel-exact, continuous vector eraser tool for [tldraw](https://tldraw.dev) (v5+).  
> **Slices, carves, and splits freehand ink strokes in real-time vector coordinates** instead of deleting the entire stroke at once.

---

## 🌟 Why this was built

By default, tldraw’s built-in eraser is an **object-level eraser**: touching any part of a vector stroke deletes the *entire* stroke. 

If you draw a complex sketch, handwritten math equation, or wireframe diagram and make a minor mistake, tldraw’s default eraser forces you to delete and redraw the entire line.

**`tldraw-continuous-eraser` brings the familiar behavior of physical erasers and bitmap painting apps (Procreate, OneNote, GoodNotes) directly to tldraw's vector canvas:**
- As you sweep across a stroke, it cuts away only the intersecting portion.
- Leaves true open space between severed ends.
- Automatically splits a single severed stroke into separate, valid tldraw shapes.
- Works 100% in vector math — **no bitmap masks, no white overlay tricks, no rasterization.**

---

## ✨ Features

- **⚡ Real-Time Vector Slicing**: Slices decoded point streams (`Vec[]`) on the fly at 60 FPS without frame drops.
- **🎯 Coordinate Space Normalization**: Mathematically re-centers every trimmed and severed piece so that local `(0, 0)` matches visual ink, preventing tldraw's selection outline from detaching or jumping to the original stroke's origin.
- **🧼 Intelligent Speck & Sliver Pruning**: Uses cumulative arc-length $\sum \|p_{i+1} - p_i\|$ and bounding span checks to cull microscopic 2-point and 3-point orphaned specks.
- **🔍 Zoom-Invariant Radius**: Automatically scales the erasing collision radius to the canvas viewport zoom level (`14px / zoom`).
- **✏️ Visual Erase Trail**: Displays a smooth feedback trail while erasing using tldraw’s native `scribbles` subsystem.
- **↩️ Transaction & History Safe**: Batches all creations, deletions, and updates into a single atomic undo/redo mark (`editor.markHistoryStoppingPoint` and `editor.run()`).
- **📦 Zero Extra Dependencies**: Built purely with tldraw primitives (`StateNode`, `Vec`, `b64Vecs`, `Box`).

---

## 🚀 Quick Start

### 1. Copy or Install

Simply copy `ContinuousEraserTool.ts` into your project, or install this directory:

```bash
# If copying directly:
cp ContinuousEraserTool.ts src/tools/ContinuousEraserTool.ts
```

### 2. Register the Tool with tldraw

Pass the `ContinuousEraserTool` class to the `tools` prop of `<Tldraw />`:

```tsx
import React from 'react';
import { Tldraw } from 'tldraw';
import 'tldraw/tldraw.css';
import { ContinuousEraserTool } from './ContinuousEraserTool';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Tldraw tools={[ContinuousEraserTool]} />
    </div>
  );
}
```

### 3. Activate the Tool

To switch to the continuous eraser, call `editor.setCurrentTool`:

```tsx
// Inside any custom toolbar or UI component with access to the editor:
editor.setCurrentTool('continuous-eraser');
```

---

## 💻 Full React Example

```tsx
import React from 'react';
import { Tldraw, useEditor, useValue } from 'tldraw';
import 'tldraw/tldraw.css';
import { ContinuousEraserTool } from './ContinuousEraserTool';

function CustomToolbar() {
  const editor = useEditor();
  const activeTool = useValue('currentTool', () => editor.getCurrentToolId(), [editor]);

  return (
    <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 50, display: 'flex', gap: 8 }}>
      <button
        onClick={() => editor.setCurrentTool('draw')}
        style={{ fontWeight: activeTool === 'draw' ? 'bold' : 'normal' }}
      >
        Pen Tool
      </button>

      <button
        onClick={() => editor.setCurrentTool('continuous-eraser')}
        style={{ fontWeight: activeTool === 'continuous-eraser' ? 'bold' : 'normal' }}
      >
        Continuous Eraser
      </button>

      <button
        onClick={() => editor.setCurrentTool('select')}
        style={{ fontWeight: activeTool === 'select' ? 'bold' : 'normal' }}
      >
        Select
      </button>
    </div>
  );
}

export default function Whiteboard() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <Tldraw
        tools={[ContinuousEraserTool]}
        components={{ Toolbar: CustomToolbar }}
      />
    </div>
  );
}
```

---

## 🔬 How the Math Works

### 1. Capsule Sweep Collision
Instead of checking only discrete point-in-circle hits (which causes gaps during fast mouse swipes), the tool constructs a **continuous capsule** between the previous pointer location $P_{prev}$ and current pointer location $P_{curr}$:
1. Checks the perpendicular distance from vertex $V_i$ to line segment $[P_{prev}, P_{curr}]$ using `Vec.DistanceToLineSegment`.
2. Checks 2D segment-segment intersection between $[V_i, V_{i+1}]$ and $[P_{prev}, P_{curr}]$ using the vector 2D cross-product:
   $$t = \frac{(b_1 - a_1) \times d_2}{d_1 \times d_2}, \quad u = \frac{(b_1 - a_1) \times d_1}{d_1 \times d_2}$$

### 2. Dynamic Shape Splitting
In tldraw, a single `draw` shape consists of `props.segments`. If you have multiple segments inside a single shape record, tldraw’s renderer connects them into a continuous stroke. 
- When an erase cut splits a stroke into multiple disconnected pieces, the first piece updates the original shape record.
- Every additional piece is instantiated as a brand new `TLShape` using `createShapeId()`, preserving stroke color, width, opacity, and layering.

### 3. Coordinate Normalization (`normalizePiece`)
When an erase cut trims a stroke, the surviving piece’s vertices are re-indexed:
1. Calculates $(\min X, \min Y)$ of the surviving vertices.
2. Moves parent coordinates `shape.x` and `shape.y` to that corner (including rotation $\theta$):
   $$\text{newX} = \text{shape.x} + (\min X \cdot \cos\theta - \min Y \cdot \sin\theta)$$
   $$\text{newY} = \text{shape.y} + (\min X \cdot \sin\theta + \min Y \cdot \cos\theta)$$
3. Offsets all vertices by $(-\min X, -\min Y)$ so the piece begins cleanly at $(0, 0)$.

> **Why this matters:** tldraw’s geometry engine defaults to a point-dot at local `(0, 0)` when a stroke is smaller than $2 \times \text{strokeWidth}$. Without normalization, selecting small strokes would cause the selection box to jump back to the original start position of the pre-erased stroke.

### 4. Physical Arc-Length Culling (`isPieceValid`)
When erasing inward from both sides of a line, two or three vertices can occasionally sit $1\text{--}3\text{px}$ apart between eraser sweeps.
- We compute the cumulative chord length $\sum \|V_{i+1} - V_i\|$ and geometric diagonal span $\sqrt{\Delta x^2 + \Delta y^2}$.
- If a fragment falls below $\max(6\text{px},\, 1.8 \times \text{strokeWidth})$, it is recognized as an orphaned speck and pruned immediately.

---

## ⚙️ Configuration & Customization

Inside `ContinuousEraserTool.ts`:

- **Eraser Width**: Change `eraseRadius = 14 / zoom;` (default is 14 screen pixels).
- **Pruning Threshold**: Change `Math.max(6, effectiveWidth * 1.8)` to increase or decrease how aggressively microscopic slivers are culled.
- **Scribble Color**: Change `color: 'muted-1'` in `ContinuousErasingState.onEnter` to `'red'`, `'laser'`, or any custom palette color.

---

##  AI Disclosure & Transparency

This project was developed with the assistance of AI tools:
- **Codebase & Architecture:** AI coding models were utilized for brainstorming vector algorithms, structuring the continuous sweep and stroke-splitting pipeline, and drafting TypeScript types. All logic has been reviewed and validated against tldraw v5+.
- **Documentation:** This `README.md` and related usage guides were written and organized with AI assistance to ensure thorough mathematical documentation, API references, and clear setup steps.

While every effort has been made to ensure correctness and stability, community feedback and contributions are warmly welcomed! If you spot any edge-cases or discrepancies, please feel free to open an issue or pull request.

---

## 📄 License

MIT © 2026. Free to use in personal, academic, and commercial projects.
