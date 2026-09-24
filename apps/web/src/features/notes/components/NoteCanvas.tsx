import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTheme } from 'next-themes';
import type { NoteBoard } from '@/lib/api/endpoints/noteBoards';
import { cn } from '@/lib/utils';
import { useSetNoteBoardVisibility } from '../services/noteBoards.service';
import StickerNode, { NewStickerContext, type StickerNodeType } from './StickerNode';
import NoteCanvasTitle from './NoteCanvasTitle';
import NoteCanvasControls from './NoteCanvasControls';
import { toFlowNodes, toFlowEdges, newSticker } from '../utils/noteCanvas';
import { useCanvasAutosave, type SaveStatus } from '../hooks/useCanvasAutosave';
import { useNoteBoardAccess } from '../hooks/useNoteBoardAccess';

// The board canvas: a React Flow surface of sticky-note nodes. Changes autosave
// (see useCanvasAutosave). Keyed by board id by the host, so the state resets when
// the board changes.
export default function NoteCanvas({
  projectKey,
  board,
}: {
  projectKey: string;
  board: NoteBoard;
}) {
  const nodeTypes = useMemo(() => ({ sticker: StickerNode }), []);
  const [nodes, setNodes, onNodesChange] = useNodesState<StickerNodeType>(
    toFlowNodes(board.canvas),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toFlowEdges(board.canvas));
  const [fullscreen, setFullscreen] = useState(false);
  // The note just added: its title field takes the focus, so typing starts there.
  const [addedId, setAddedId] = useState<string | null>(null);
  const tA11y = useTranslations('notes.canvasA11y');
  // React Flow's own screen reader labels, in the reader's language.
  const ariaLabelConfig = useMemo(
    () => ({
    'node.a11yDescription.default': tA11y('node'),
    'node.a11yDescription.keyboardDisabled': tA11y('nodeKeyboardDisabled'),
    'node.a11yDescription.ariaLiveMessage': ({ x, y }: { x: number; y: number }) =>
      tA11y('nodeMoved', { x: Math.round(x), y: Math.round(y) }),
    'edge.a11yDescription.default': tA11y('edge'),
    'controls.ariaLabel': tA11y('controls'),
    'controls.zoomIn.ariaLabel': tA11y('zoomIn'),
    'controls.zoomOut.ariaLabel': tA11y('zoomOut'),
    'controls.fitView.ariaLabel': tA11y('fitView'),
    'controls.interactive.ariaLabel': tA11y('interactive'),
    'minimap.ariaLabel': tA11y('minimap'),
    'handle.ariaLabel': tA11y('handle'),
    }),
    [tA11y],
  );

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  const { screenToFlowPosition } = useReactFlow();
  const { resolvedTheme } = useTheme();

  const setVisibility = useSetNoteBoardVisibility(projectKey);
  const { canEdit, canChangeVisibility } = useNoteBoardAccess(board);

  // The canvas autosave and the access changes report through one status line
  // after the board name, so changing who sees the board shows Saving…/Saved too.
  const canvasStatus = useCanvasAutosave(projectKey, board.id, nodes, edges, canEdit);
  let saveStatus: SaveStatus = 'saved';
  if (canvasStatus === 'saving' || setVisibility.isPending) saveStatus = 'saving';
  else if (canvasStatus === 'error' || setVisibility.isError) saveStatus = 'error';
  else if (canvasStatus === 'unsaved') saveStatus = 'unsaved';

  const onConnect = useCallback(
    (conn: Connection) => setEdges((eds) => addEdge(conn, eds)),
    [setEdges],
  );

  const addAt = useCallback(
    (x: number, y: number) => {
      const sticker = newSticker(screenToFlowPosition({ x, y }));
      setAddedId(sticker.id);
      setNodes((nds) => [...nds, sticker]);
    },
    [screenToFlowPosition, setNodes],
  );

  const addAtCenter = () => {
    const r = document.querySelector('.react-flow')?.getBoundingClientRect();
    addAt((r?.left ?? 0) + (r?.width ?? 0) / 2, (r?.top ?? 0) + (r?.height ?? 0) / 2);
  };

  // Only a double-click on empty canvas adds a note; double-clicking a node must not.
  const onDoubleClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    if ((e.target as HTMLElement).classList.contains('react-flow__pane')) {
      addAt(e.clientX, e.clientY);
    }
  };

  return (
    <div
      className={cn('relative flex-1', fullscreen && 'fixed inset-0 z-50 bg-background')}
      onDoubleClick={onDoubleClick}
    >
      <NoteCanvasTitle board={board} saveStatus={saveStatus} fullscreen={fullscreen} />

      <NoteCanvasControls
        projectKey={projectKey}
        canEdit={canEdit}
        visibility={board.visibility}
        ownerUserId={board.ownerUserId}
        memberIds={board.memberIds}
        canChangeVisibility={canChangeVisibility}
        fullscreen={fullscreen}
        onAddNote={addAtCenter}
        onChangeVisibility={(visibility, memberIds) =>
          setVisibility.mutate({ boardId: board.id, visibility, memberIds })
        }
        onToggleFullscreen={() => setFullscreen((v) => !v)}
      />

      <NewStickerContext.Provider value={addedId}>
      <ReactFlow
        ariaLabelConfig={ariaLabelConfig}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodesDraggable={canEdit}
        nodesConnectable={canEdit}
        // 'Backspace' is React Flow's default; null disables deleting by key.
        deleteKeyCode={canEdit ? 'Backspace' : null}
        fitView
        // Cap the fit zoom at 1:1 so a board with a single small note is not
        // blown up to fill the viewport.
        fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
        colorMode={resolvedTheme === 'light' ? 'light' : 'dark'}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background />
        <Controls />
      </ReactFlow>
      </NewStickerContext.Provider>
    </div>
  );
}
