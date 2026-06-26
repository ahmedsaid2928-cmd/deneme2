import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle } from 'react-native-svg';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useDrawing, Stroke, Point, PenType, ShapeType, Tool } from '@/contexts/DrawingContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIDEBAR_BG = '#1e2128';
const CANVAS_BG = '#ffffff';
const ACTIVE_COLOR = '#e63946';
const INACTIVE_ICON = 'rgba(255,255,255,0.45)';

const COLORS: string[] = [
  '#000000', '#434343', '#666666', '#999999',
  '#e63946', '#ff6b35', '#ffbe0b', '#06d6a0',
  '#4cc9f0', '#4361ee', '#7209b7', '#ff006e',
  '#a8dadc', '#606c38', '#8ecae6', '#283618',
  '#ffffff', '#f4f1de', '#e07a5f', '#81b29a',
];

const SIZES: number[] = [2, 4, 8, 14, 22];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substring(2, 8);
}

function pointsToPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}l0.01,0`;
  let d = `M${pts[0].x},${pts[0].y}`;
  if (pts.length === 2) return d + `L${pts[1].x},${pts[1].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += `Q${pts[i].x},${pts[i].y},${mx},${my}`;
  }
  d += `L${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  return d;
}

interface StrokeProps {
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  linecap: 'round' | 'square' | 'butt';
}

function getStrokeProps(stroke: Stroke): StrokeProps {
  if (stroke.isEraser) {
    return { strokeColor: CANVAS_BG, strokeWidth: stroke.strokeWidth * 4, strokeOpacity: 1, linecap: 'round' };
  }
  switch (stroke.penType) {
    case 'fountain':
      return { strokeColor: stroke.color, strokeWidth: stroke.strokeWidth * 1.4, strokeOpacity: 0.88, linecap: 'round' };
    case 'marker':
      return { strokeColor: stroke.color, strokeWidth: stroke.strokeWidth * 5, strokeOpacity: 0.45, linecap: 'square' };
    default:
      return { strokeColor: stroke.color, strokeWidth: stroke.strokeWidth, strokeOpacity: 1, linecap: 'round' };
  }
}

function makeCirclePoints(cx: number, cy: number, r: number): Point[] {
  const pts: Point[] = [];
  for (let a = 0; a <= 360; a += 4) {
    const rad = (a * Math.PI) / 180;
    pts.push({ x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) });
  }
  return pts;
}

function makeTrianglePoints(cx: number, cy: number, r: number): Point[] {
  return [
    { x: cx, y: cy - r },
    { x: cx + r * Math.cos(Math.PI / 6), y: cy + r * 0.5 },
    { x: cx - r * Math.cos(Math.PI / 6), y: cy + r * 0.5 },
    { x: cx, y: cy - r },
  ];
}

// ─── Pen Type Button ─────────────────────────────────────────────────────────

interface PenTypeBtnProps {
  type: PenType;
  label: string;
  active: boolean;
  onPress: () => void;
}

function PenTypeBtn({ type, label, active, onPress }: PenTypeBtnProps) {
  const lineHeight = type === 'ballpoint' ? 2 : type === 'fountain' ? 3.5 : 8;
  const lineOpacity = type === 'marker' ? 0.55 : 1;
  return (
    <TouchableOpacity
      style={[s.penTypeBtn, active && s.penTypeBtnActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[s.penTypeSample, { height: lineHeight, opacity: lineOpacity }]} />
      <Text style={[s.penTypeLbl, active && s.penTypeLblActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function DrawingScreen() {
  const insets = useSafeAreaInsets();
  const {
    strokes,
    currentTool, currentColor, brushSize, penType, shapeType,
    setCurrentTool, setCurrentColor, setBrushSize, setPenType, setShapeType,
    addStroke, undo, redo, clear, canUndo, canRedo,
  } = useDrawing();

  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [shapePreview, setShapePreview] = useState<{ start: Point; end: Point } | null>(null);

  // Refs to access latest state inside PanResponder without recreating it
  const toolRef = useRef<Tool>(currentTool);
  const colorRef = useRef(currentColor);
  const sizeRef = useRef(brushSize);
  const penTypeRef = useRef<PenType>(penType);
  const shapeTypeRef = useRef<ShapeType>(shapeType);
  const currentPtsRef = useRef<Point[]>([]);
  const shapeStartRef = useRef<Point | null>(null);

  toolRef.current = currentTool;
  colorRef.current = currentColor;
  sizeRef.current = brushSize;
  penTypeRef.current = penType;
  shapeTypeRef.current = shapeType;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => toolRef.current !== 'cursor',
      onMoveShouldSetPanResponder: () => toolRef.current !== 'cursor',

      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const pt: Point = { x: locationX, y: locationY };
        const tool = toolRef.current;

        if (tool === 'pen' || tool === 'eraser') {
          currentPtsRef.current = [pt];
          setCurrentPoints([pt]);
        } else if (tool === 'shape') {
          shapeStartRef.current = pt;
          setShapePreview({ start: pt, end: pt });
        }
      },

      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const pt: Point = { x: locationX, y: locationY };
        const tool = toolRef.current;

        if (tool === 'pen' || tool === 'eraser') {
          currentPtsRef.current = [...currentPtsRef.current, pt];
          setCurrentPoints([...currentPtsRef.current]);
        } else if (tool === 'shape' && shapeStartRef.current) {
          setShapePreview({ start: shapeStartRef.current, end: pt });
        }
      },

      onPanResponderRelease: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        const tool = toolRef.current;

        if ((tool === 'pen' || tool === 'eraser') && currentPtsRef.current.length > 0) {
          const newStroke: Stroke = {
            id: genId(),
            points: [...currentPtsRef.current],
            color: colorRef.current,
            strokeWidth: sizeRef.current,
            penType: penTypeRef.current,
            isEraser: tool === 'eraser',
          };
          addStroke(newStroke);
          currentPtsRef.current = [];
          setCurrentPoints([]);
        } else if (tool === 'shape' && shapeStartRef.current) {
          const start = shapeStartRef.current;
          const dx = locationX - start.x;
          const dy = locationY - start.y;
          const r = Math.sqrt(dx * dx + dy * dy) / 2;
          const cx = (start.x + locationX) / 2;
          const cy = (start.y + locationY) / 2;

          if (r > 5) {
            const pts =
              shapeTypeRef.current === 'circle'
                ? makeCirclePoints(cx, cy, r)
                : makeTrianglePoints(cx, cy, r);

            const newStroke: Stroke = {
              id: genId(),
              points: pts,
              color: colorRef.current,
              strokeWidth: sizeRef.current,
              penType: penTypeRef.current,
              isEraser: false,
              shapeType: shapeTypeRef.current,
            };
            addStroke(newStroke);
          }

          shapeStartRef.current = null;
          setShapePreview(null);
        }
      },

      // Clean up state if gesture is cancelled (system interruption, multi-touch, etc.)
      onPanResponderTerminationRequest: () => true,
      onPanResponderTerminate: () => {
        currentPtsRef.current = [];
        setCurrentPoints([]);
        shapeStartRef.current = null;
        setShapePreview(null);
      },
    })
  ).current;

  const handleClear = () => {
    Alert.alert(
      'Tümünü Sil',
      'Tüm çizimler silinecek. Devam?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Sil',
          style: 'destructive',
          onPress: () => {
            clear();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          },
        },
      ]
    );
  };

  const paddingTop = Platform.OS === 'web' ? 67 : insets.top;
  const paddingBottom = Platform.OS === 'web' ? 34 : insets.bottom;

  // Render current in-progress freehand stroke
  const renderLiveStroke = () => {
    if (currentPoints.length === 0) return null;
    const isEraser = currentTool === 'eraser';
    let sw = brushSize;
    let op = 1;
    let lc: 'round' | 'square' | 'butt' = 'round';
    if (isEraser) { sw = brushSize * 4; }
    else if (penType === 'fountain') { sw = brushSize * 1.4; op = 0.88; }
    else if (penType === 'marker') { sw = brushSize * 5; op = 0.45; lc = 'square'; }
    return (
      <Path
        d={pointsToPath(currentPoints)}
        stroke={isEraser ? CANVAS_BG : currentColor}
        strokeWidth={sw}
        strokeOpacity={op}
        strokeLinecap={lc}
        strokeLinejoin={lc === 'round' ? 'round' : 'miter'}
        fill="none"
      />
    );
  };

  // Render shape drag preview — same pen multipliers as persisted strokes
  const renderShapePreview = () => {
    if (!shapePreview || currentTool !== 'shape') return null;
    const { start, end } = shapePreview;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const r = Math.sqrt(dx * dx + dy * dy) / 2;
    const cx = (start.x + end.x) / 2;
    const cy = (start.y + end.y) / 2;
    if (r < 2) return null;

    // Mirror the same multipliers used in getStrokeProps
    let sw = brushSize;
    let op = 1;
    let lc: 'round' | 'square' | 'butt' = 'round';
    if (penType === 'fountain') { sw = brushSize * 1.4; op = 0.88; }
    else if (penType === 'marker') { sw = brushSize * 5; op = 0.45; lc = 'square'; }

    if (shapeType === 'circle') {
      return (
        <Circle
          cx={cx} cy={cy} r={r}
          stroke={currentColor}
          strokeWidth={sw}
          strokeOpacity={op}
          strokeLinecap={lc}
          fill="none"
        />
      );
    }
    const pts = makeTrianglePoints(cx, cy, r);
    return (
      <Path
        d={pointsToPath(pts)}
        stroke={currentColor}
        strokeWidth={sw}
        strokeOpacity={op}
        fill="none"
        strokeLinecap={lc}
        strokeLinejoin={lc === 'round' ? 'round' : 'miter'}
      />
    );
  };

  return (
    <View style={[s.root, { paddingTop, paddingBottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={s.main}>
        {/* ── Left Sidebar ── */}
        <View style={s.sidebar}>
          {/* MC Logo */}
          <View style={s.logo}>
            <Text style={s.logoText}>MC</Text>
          </View>

          <View style={s.divider} />

          {/* Cursor */}
          <ToolButton
            active={currentTool === 'cursor'}
            onPress={() => { setCurrentTool('cursor'); Haptics.selectionAsync(); }}
          >
            <MaterialCommunityIcons
              name="cursor-default-outline"
              size={24}
              color={currentTool === 'cursor' ? ACTIVE_COLOR : INACTIVE_ICON}
            />
          </ToolButton>

          {/* Pen */}
          <ToolButton
            active={currentTool === 'pen'}
            onPress={() => { setCurrentTool('pen'); Haptics.selectionAsync(); }}
          >
            <Feather
              name="edit-2"
              size={22}
              color={currentTool === 'pen' ? ACTIVE_COLOR : INACTIVE_ICON}
            />
          </ToolButton>

          {/* Eraser */}
          <ToolButton
            active={currentTool === 'eraser'}
            onPress={() => { setCurrentTool('eraser'); Haptics.selectionAsync(); }}
          >
            <MaterialCommunityIcons
              name="eraser"
              size={24}
              color={currentTool === 'eraser' ? ACTIVE_COLOR : INACTIVE_ICON}
            />
          </ToolButton>

          {/* Undo / Redo appear when eraser is selected */}
          {currentTool === 'eraser' && (
            <>
              <ToolButton
                active={false}
                disabled={!canUndo}
                onPress={() => { undo(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <MaterialCommunityIcons
                  name="undo"
                  size={22}
                  color={canUndo ? '#ffffff' : 'rgba(255,255,255,0.2)'}
                />
              </ToolButton>
              <ToolButton
                active={false}
                disabled={!canRedo}
                onPress={() => { redo(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
              >
                <MaterialCommunityIcons
                  name="redo"
                  size={22}
                  color={canRedo ? '#ffffff' : 'rgba(255,255,255,0.2)'}
                />
              </ToolButton>
            </>
          )}

          {/* Shape */}
          <ToolButton
            active={currentTool === 'shape'}
            onPress={() => { setCurrentTool('shape'); Haptics.selectionAsync(); }}
          >
            <MaterialCommunityIcons
              name={shapeType === 'circle' ? 'circle-outline' : 'triangle-outline'}
              size={24}
              color={currentTool === 'shape' ? ACTIVE_COLOR : INACTIVE_ICON}
            />
          </ToolButton>

          {/* Shape sub-buttons */}
          {currentTool === 'shape' && (
            <>
              <TouchableOpacity
                style={[s.subBtn, shapeType === 'circle' && s.subBtnActive]}
                onPress={() => setShapeType('circle')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="circle-outline"
                  size={17}
                  color={shapeType === 'circle' ? ACTIVE_COLOR : INACTIVE_ICON}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.subBtn, shapeType === 'triangle' && s.subBtnActive]}
                onPress={() => setShapeType('triangle')}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="triangle-outline"
                  size={17}
                  color={shapeType === 'triangle' ? ACTIVE_COLOR : INACTIVE_ICON}
                />
              </TouchableOpacity>
            </>
          )}

          <View style={{ flex: 1 }} />

          {/* Clear */}
          <ToolButton active={false} onPress={handleClear}>
            <MaterialCommunityIcons name="trash-can-outline" size={22} color="rgba(255,100,100,0.8)" />
          </ToolButton>
        </View>

        {/* ── Canvas Area ── */}
        <View style={s.canvasArea}>
          {/* Drawing Canvas */}
          <View
            style={s.canvas}
            onLayout={(e) =>
              setCanvasSize({
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              })
            }
            {...panResponder.panHandlers}
          >
            {canvasSize.width > 0 && (
              <Svg
                width={canvasSize.width}
                height={canvasSize.height}
                style={StyleSheet.absoluteFill}
              >
                {strokes.map((stroke) => {
                  const p = getStrokeProps(stroke);
                  return (
                    <Path
                      key={stroke.id}
                      d={pointsToPath(stroke.points)}
                      stroke={p.strokeColor}
                      strokeWidth={p.strokeWidth}
                      strokeOpacity={p.strokeOpacity}
                      strokeLinecap={p.linecap}
                      strokeLinejoin={p.linecap === 'round' ? 'round' : 'miter'}
                      fill="none"
                    />
                  );
                })}
                {renderLiveStroke()}
                {renderShapePreview()}
              </Svg>
            )}
          </View>

          {/* ── Bottom Options Bar ── */}
          <View style={s.optionsBar}>
            {/* Pen type selector (only when pen tool active) */}
            {currentTool === 'pen' && (
              <View style={s.penTypeRow}>
                <PenTypeBtn
                  type="ballpoint"
                  label="Kalem"
                  active={penType === 'ballpoint'}
                  onPress={() => { setPenType('ballpoint'); Haptics.selectionAsync(); }}
                />
                <PenTypeBtn
                  type="fountain"
                  label="Dolma"
                  active={penType === 'fountain'}
                  onPress={() => { setPenType('fountain'); Haptics.selectionAsync(); }}
                />
                <PenTypeBtn
                  type="marker"
                  label="İşaretçi"
                  active={penType === 'marker'}
                  onPress={() => { setPenType('marker'); Haptics.selectionAsync(); }}
                />
              </View>
            )}

            {/* Size selector */}
            <View style={s.sizeRow}>
              {SIZES.map((size) => (
                <TouchableOpacity
                  key={size}
                  style={[s.sizeBtn, brushSize === size && s.sizeBtnActive]}
                  onPress={() => { setBrushSize(size); Haptics.selectionAsync(); }}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      s.sizeDot,
                      {
                        width: Math.min(size * 2.2, 32),
                        height: Math.min(size * 2.2, 32),
                        borderRadius: Math.min(size * 1.1, 16),
                        backgroundColor:
                          brushSize === size ? currentColor : 'rgba(255,255,255,0.45)',
                      },
                    ]}
                  />
                </TouchableOpacity>
              ))}
            </View>

            {/* Color palette */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.colorScroll}
              contentContainerStyle={s.colorContent}
            >
              {COLORS.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    s.swatch,
                    { backgroundColor: color },
                    currentColor === color && s.swatchActive,
                    color === '#ffffff' && s.swatchWhite,
                  ]}
                  onPress={() => { setCurrentColor(color); Haptics.selectionAsync(); }}
                  activeOpacity={0.8}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── ToolButton Component ────────────────────────────────────────────────────

interface ToolButtonProps {
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

function ToolButton({ active, disabled, onPress, children }: ToolButtonProps) {
  return (
    <TouchableOpacity
      style={[s.toolBtn, active && s.toolBtnActive, disabled && s.toolBtnDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      {children}
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: SIDEBAR_BG,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 68,
    backgroundColor: SIDEBAR_BG,
    alignItems: 'center',
    paddingVertical: 10,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: 'rgba(255,255,255,0.1)',
  },
  logo: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: ACTIVE_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  logoText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  divider: {
    width: 34,
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 8,
  },
  toolBtn: {
    width: 48,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 2,
  },
  toolBtnActive: {
    backgroundColor: 'rgba(230,57,70,0.15)',
  },
  toolBtnDisabled: {
    opacity: 0.35,
  },
  subBtn: {
    width: 40,
    height: 34,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 1,
  },
  subBtnActive: {
    backgroundColor: 'rgba(230,57,70,0.15)',
  },
  canvasArea: {
    flex: 1,
    flexDirection: 'column',
  },
  canvas: {
    flex: 1,
    backgroundColor: CANVAS_BG,
    overflow: 'hidden',
  },
  optionsBar: {
    backgroundColor: SIDEBAR_BG,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  penTypeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 8,
  },
  penTypeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    minWidth: 72,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  penTypeBtnActive: {
    backgroundColor: 'rgba(230,57,70,0.18)',
    borderColor: ACTIVE_COLOR,
  },
  penTypeSample: {
    width: 38,
    backgroundColor: '#ffffff',
    borderRadius: 2,
    marginBottom: 4,
  },
  penTypeLbl: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    fontFamily: 'Inter_400Regular',
  },
  penTypeLblActive: {
    color: ACTIVE_COLOR,
    fontFamily: 'Inter_600SemiBold',
  },
  sizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    gap: 4,
  },
  sizeBtn: {
    width: 46,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  sizeBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.13)',
  },
  sizeDot: {
    // dynamic dimensions set inline
  },
  colorScroll: {
    maxHeight: 40,
  },
  colorContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    gap: 7,
  },
  swatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: {
    borderColor: '#ffffff',
    transform: [{ scale: 1.18 }],
  },
  swatchWhite: {
    borderColor: 'rgba(255,255,255,0.35)',
  },
});
