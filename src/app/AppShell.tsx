import type { PropsWithChildren } from 'react';

import ErrorBoundary from '../components/common/ErrorBoundary';
import { ReloadPrompt } from '../components/ReloadPrompt';
import { useAutoSave } from '../hooks/useAutoSave';
import { useOrientationLock } from '../hooks/useOrientationLock';

function AppShell({ children }: PropsWithChildren) {
  // 可能な限り縦画面に固定を試みる（スマホ対策）
  useOrientationLock('portrait');

  // 自動保存機能（2分間隔）
  useAutoSave();

  return (
    <ErrorBoundary>
      {children}
      <ReloadPrompt />
    </ErrorBoundary>
  );
}

export default AppShell;