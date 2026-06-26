import React, { createContext, useContext, useState, useRef, ReactNode } from 'react';

export type Point = { x: number; y: number };
export type PenType = 'ballpoint' | 'fountain' | 'marker';
export type Tool = 'cursor' | 'pen' | 'eraser' | 'shape';
export type ShapeType = 'circle' | 'triangle';

export interface Stroke {
  id: string;
  points: Point[];
  color: string;
  strokeWidth: number;
  penType: PenType;
  isEraser: boolean;
  shapeType?: ShapeType;
}

interface DrawingContextType {
  strokes: Stroke[];
  undoneStrokes: Stroke[];
  currentTool: Tool;
  currentColor: string;
  brushSize: number;
  penType: PenType;
  shapeType: ShapeType;
  setCurrentTool: (tool: Tool) => void;
  setCurrentColor: (color: string) => void;
  setBrushSize: (size: number) => void;
  setPenType: (type: PenType) => void;
  setShapeType: (type: ShapeType) => void;
  addStroke: (stroke: Stroke) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DrawingContext = createContext<DrawingContextType | null>(null);

export function DrawingProvider({ children }: { children: ReactNode }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [undoneStrokes, setUndoneStrokes] = useState<Stroke[]>([]);
  const [currentTool, setCurrentToolState] = useState<Tool>('pen');
  const [currentColor, setCurrentColor] = useState('#000000');
  const [brushSize, setBrushSize] = useState(4);
  const [penType, setPenType] = useState<PenType>('ballpoint');
  const [shapeType, setShapeType] = useState<ShapeType>('circle');

  const setCurrentTool = (tool: Tool) => setCurrentToolState(tool);

  const addStroke = (stroke: Stroke) => {
    setStrokes(prev => [...prev, stroke]);
    setUndoneStrokes([]);
  };

  const undo = () => {
    setStrokes(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoneStrokes(u => [...u, last]);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setUndoneStrokes(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setStrokes(s => [...s, last]);
      return prev.slice(0, -1);
    });
  };

  const clear = () => {
    setStrokes([]);
    setUndoneStrokes([]);
  };

  return (
    <DrawingContext.Provider
      value={{
        strokes,
        undoneStrokes,
        currentTool,
        currentColor,
        brushSize,
        penType,
        shapeType,
        setCurrentTool,
        setCurrentColor,
        setBrushSize,
        setPenType,
        setShapeType,
        addStroke,
        undo,
        redo,
        clear,
        canUndo: strokes.length > 0,
        canRedo: undoneStrokes.length > 0,
      }}
    >
      {children}
    </DrawingContext.Provider>
  );
}

export function useDrawing(): DrawingContextType {
  const ctx = useContext(DrawingContext);
  if (!ctx) throw new Error('useDrawing must be used within DrawingProvider');
  return ctx;
}
