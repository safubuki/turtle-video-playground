import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiModal from '../components/modals/AiModal';
import SettingsModal from '../components/modals/SettingsModal';

const logStoreState = {
  entries: [],
  hasError: false,
  clearLogs: vi.fn(),
  clearErrorFlag: vi.fn(),
  exportLogs: vi.fn(() => '[]'),
};

const updateStoreState = {
  needRefresh: false,
  updateServiceWorker: vi.fn(),
};

vi.mock('../stores', () => ({
  useLogStore: (selector: (state: typeof logStoreState) => unknown) => selector(logStoreState),
}));

vi.mock('../stores/updateStore', () => ({
  useUpdateStore: () => updateStoreState,
}));

vi.mock('../hooks/useDisableBodyScroll', () => ({
  useDisableBodyScroll: () => {},
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('modal backdrop behavior', () => {
  it('SettingsModal は領域外クリックで閉じる', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal isOpen={true} onClose={onClose} />);

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('AiModal は領域外クリックでは閉じない', () => {
    const onClose = vi.fn();
    const { container } = render(
      <AiModal
        isOpen={true}
        onClose={onClose}
        aiPrompt=""
        aiScript=""
        aiScriptLength="short"
        aiVoice="Aoede"
        aiVoiceStyle=""
        isAiLoading={false}
        voiceOptions={[{ id: 'Aoede', label: 'Aoede', desc: 'default' }]}
        onPromptChange={() => {}}
        onScriptChange={() => {}}
        onScriptLengthChange={() => {}}
        onVoiceChange={() => {}}
        onVoiceStyleChange={() => {}}
        onGenerateScript={() => {}}
        onGenerateSpeech={() => {}}
      />
    );

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });
});
