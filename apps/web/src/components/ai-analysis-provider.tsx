'use client';

import { canComment, type AiFinding, type LatestAnalysisResponse } from '@diffcraft/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  dismissFinding,
  loadLatestAnalysis,
  runAnalysis,
  setFindingFeedback,
} from '@/lib/ai-actions';
import {
  analysisReducer,
  findingTarget,
  findingThreadBody,
  groupFindingsByKey,
  initialAnalysisState,
  optimistic,
  visibleFindings,
  withFeedback,
  type AnalysisState,
} from '@/lib/ai-analysis';
import { runAiAction, type AiActionError } from '@/lib/ai-errors';
import { browserStorage, createFlagStore } from '@/lib/stored-flag';
import { useComments, useRoomEvents } from './comments-provider';

export interface AiAnalysisContextValue {
  state: AnalysisState;
  loadFailed: boolean;
  findings: AiFinding[];
  findingsForKeys: (keys: string[]) => AiFinding[];
  reviewOpen: boolean;
  canAct: boolean;
  canStartThread: boolean;
  filesHref: string;
  showInline: boolean;
  setShowInline: (show: boolean) => void;
  errors: ReadonlyMap<string, string>;
  pending: ReadonlySet<string>;
  run: () => Promise<AiActionError | null>;
  dismiss: (finding: AiFinding) => Promise<void>;
  feedback: (finding: AiFinding, helpful: boolean) => Promise<void>;
  startThread: (finding: AiFinding) => Promise<void>;
}

const AiAnalysisContext = createContext<AiAnalysisContextValue | null>(null);

export function useAiAnalysis(): AiAnalysisContextValue | null {
  return useContext(AiAnalysisContext);
}

export function useLineFindings(keys: string[]): AiFinding[] {
  const ai = useAiAnalysis();
  if (!ai?.showInline) return [];
  return ai.findingsForKeys(keys);
}

export const showFindingsStore = createFlagStore(
  'diffcraft:show-ai-findings',
  true,
  browserStorage,
);
const showByDefault = () => true;

export function AiAnalysisProvider({
  workspaceId,
  reviewNumber,
  initial,
  loadedAt,
  reviewOpen,
  children,
}: {
  workspaceId: string;
  reviewNumber: string;
  initial: LatestAnalysisResponse | null;
  loadedAt: string;
  reviewOpen: boolean;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(analysisReducer, null, () =>
    initialAnalysisState(initial, loadedAt),
  );
  const [loadFailed, setLoadFailed] = useState(initial === null);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const showInline = useSyncExternalStore(
    showFindingsStore.subscribe,
    showFindingsStore.get,
    showByDefault,
  );
  const comments = useComments();
  const bus = useRoomEvents();
  const refetchCount = useRef(0);

  const setError = useCallback((id: string, message: string | null) => {
    setErrors((current) => {
      const next = new Map(current);
      if (message === null) next.delete(id);
      else next.set(id, message);
      return next;
    });
  }, []);
  const setBusy = useCallback((id: string, busy: boolean) => {
    setPending((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refetch = useCallback(async () => {
    const current = ++refetchCount.current;
    const result = await runAiAction(() => loadLatestAnalysis(workspaceId, reviewNumber));
    // A slower, older request must not overwrite a newer one.
    if (!result.ok || current !== refetchCount.current) return;
    setLoadFailed(false);
    dispatch({ type: 'loaded', latest: result.data.latest, loadedAt: result.data.loadedAt });
  }, [workspaceId, reviewNumber]);

  useEffect(
    () =>
      bus?.subscribe({
        onAnalysisStatus: (event) => dispatch({ type: 'status', job: event.job, at: event.at }),
        onAnalysisCompleted: () => void refetch(),
        onResync: () => void refetch(),
      }),
    [bus, refetch],
  );

  const findings = useMemo(() => visibleFindings(state), [state]);
  const byKey = useMemo(() => groupFindingsByKey(findings), [findings]);
  const findingsForKeys = useCallback(
    (keys: string[]) => keys.flatMap((key) => byKey.get(key) ?? []),
    [byKey],
  );

  const canAct = comments !== null && canComment(comments.viewer.role);
  const canStartThread = canAct && comments !== null && !comments.loadFailed;

  const dismiss = useCallback(
    async (finding: AiFinding) => {
      setError(finding.id, null);
      await optimistic({
        apply: () => dispatch({ type: 'hide', id: finding.id }),
        call: () => runAiAction(() => dismissFinding(workspaceId, reviewNumber, finding.id)),
        commit: () => {},
        rollback: (error) => {
          dispatch({ type: 'unhide', id: finding.id });
          setError(finding.id, error.message);
        },
      });
    },
    [workspaceId, reviewNumber, setError],
  );

  const value = useMemo<AiAnalysisContextValue>(
    () => ({
      state,
      loadFailed,
      findings,
      findingsForKeys,
      reviewOpen,
      canAct,
      canStartThread,
      filesHref: `/workspaces/${workspaceId}/reviews/${reviewNumber}/files`,
      showInline,
      setShowInline: showFindingsStore.set,
      errors,
      pending,
      async run() {
        const result = await runAiAction(() => runAnalysis(workspaceId, reviewNumber));
        if (!result.ok) return result.error;
        dispatch({ type: 'started', job: result.data });
        return null;
      },
      dismiss,
      async feedback(finding, helpful) {
        const next = finding.myFeedback === helpful ? null : helpful;
        setError(finding.id, null);
        await optimistic({
          apply: () => dispatch({ type: 'finding', finding: withFeedback(finding, next) }),
          call: () =>
            runAiAction(() =>
              setFindingFeedback(workspaceId, reviewNumber, finding.id, { helpful: next }),
            ),
          commit: (saved) => dispatch({ type: 'finding', finding: saved }),
          rollback: (error) => {
            dispatch({ type: 'finding', finding });
            setError(finding.id, error.message);
          },
        });
      },
      async startThread(finding) {
        const target = findingTarget(finding);
        if (!comments || !target) return;
        setError(finding.id, null);
        setBusy(finding.id, true);
        const error = await comments.startThread(target, findingThreadBody(finding));
        setBusy(finding.id, false);
        if (error) setError(finding.id, error.message);
        else await dismiss(finding);
      },
    }),
    [
      state,
      loadFailed,
      findings,
      findingsForKeys,
      reviewOpen,
      canAct,
      canStartThread,
      workspaceId,
      reviewNumber,
      showInline,
      errors,
      pending,
      dismiss,
      comments,
      setError,
      setBusy,
    ],
  );

  return <AiAnalysisContext.Provider value={value}>{children}</AiAnalysisContext.Provider>;
}
