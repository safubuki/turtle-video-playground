import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '../../stores/updateStore';

type MockRegistration = Pick<
  ServiceWorkerRegistration,
  'waiting' | 'installing' | 'update' | 'addEventListener' | 'removeEventListener'
>;

function createRegistration(waiting: ServiceWorker | null = null): MockRegistration {
  const registration: MockRegistration = {
    waiting,
    installing: null,
    update: vi.fn(async () => registration as ServiceWorkerRegistration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return registration;
}

describe('updateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUpdateStore.setState({
      needRefresh: false,
      offlineReady: false,
      registration: null,
      isCheckingForUpdate: false,
      pendingUpdateCheckAfterRegister: false,
      isApplyingUpdate: false,
      updateServiceWorkerImpl: async () => {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registration.waiting があれば更新ありを返す', async () => {
    const registration = createRegistration({} as ServiceWorker);
    useUpdateStore.getState().setRegistration(registration as ServiceWorkerRegistration);

    const result = await useUpdateStore.getState().checkForUpdate();

    expect(result).toBe('update-found');
    expect(useUpdateStore.getState().needRefresh).toBe(true);
  });

  it('更新が無ければ最新扱いにする', async () => {
    const registration = createRegistration();
    useUpdateStore.getState().setRegistration(registration as ServiceWorkerRegistration);

    const pending = useUpdateStore.getState().checkForUpdate();
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pending;

    expect(result).toBe('up-to-date');
    expect(useUpdateStore.getState().needRefresh).toBe(false);
  });

  it('更新適用は多重実行されず、適用開始時に更新通知を閉じる', async () => {
    let resolveUpdate: (() => void) | undefined;
    const updateImpl = vi.fn(() => new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    }));

    useUpdateStore.getState().setUpdateServiceWorker(updateImpl);
    useUpdateStore.setState({ needRefresh: true });

    const first = useUpdateStore.getState().updateServiceWorker(true);
    const second = useUpdateStore.getState().updateServiceWorker(true);

    expect(updateImpl).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().needRefresh).toBe(false);
    expect(useUpdateStore.getState().isApplyingUpdate).toBe(true);

    if (!resolveUpdate) {
      throw new Error('update resolver was not initialized');
    }

    resolveUpdate();
    await first;
    await second;
    await vi.advanceTimersByTimeAsync(3000);

    expect(useUpdateStore.getState().isApplyingUpdate).toBe(false);
  });

  it('更新適用が失敗した場合は再試行できる状態へ戻す', async () => {
    const updateImpl = vi.fn().mockRejectedValue(new Error('apply failed'));

    useUpdateStore.getState().setUpdateServiceWorker(updateImpl);
    useUpdateStore.setState({ needRefresh: true });

    await expect(useUpdateStore.getState().updateServiceWorker(true)).rejects.toThrow('apply failed');

    expect(useUpdateStore.getState().needRefresh).toBe(true);
    expect(useUpdateStore.getState().isApplyingUpdate).toBe(false);
  });
});
