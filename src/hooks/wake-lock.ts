import { useCallback, useEffect, useState } from 'react';

type WakeLockSentinel = {
    released: boolean;
    release: () => Promise<void>;
    addEventListener: (type: 'release', listener: () => void) => void;
};

type WakeLock = {
    request: (type: 'screen') => Promise<WakeLockSentinel>;
};

const getWakeLock = () =>
    (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;

/**
 * A hook to lock the screen from sleeping.
 * Uses the Screen Wake Lock API.
 * Handles visibility changes automatically.
 */
export function useWakeLock() {
    const [isLocked, setIsLocked] = useState(false);
    const [isSupported] = useState(() => {
        if (typeof navigator === 'undefined') return false;
        return Boolean(getWakeLock());
    });
    const [error, setError] = useState<string | null>(null);

    const requestLock = useCallback(async () => {
        const wakeLock = getWakeLock();
        if (!wakeLock) return;

        try {
            const wakeLockSentinel = await wakeLock.request('screen');
            setIsLocked(true); // If we get here, we have the lock

            wakeLockSentinel.addEventListener('release', () => {
                setIsLocked(false);
            });

            return wakeLockSentinel;
        } catch (err: unknown) {
            const error = err as Error;
            console.error(`Wake Lock error: ${error.name}, ${error.message}`);
            setError(error.message);
            setIsLocked(false);
            return null;
        }
    }, []);

    useEffect(() => {
        // Keep track of the lock object so we can release it on cleanup
        let wakeLockSentinel: unknown = null;

        const init = async () => {
            wakeLockSentinel = await requestLock();
        };

        if (isSupported) {
            init();
        }

        const handleVisibilityChange = async () => {
            if (document.visibilityState === 'visible' && isSupported) {
                // Re-acquire lock when page becomes visible
                wakeLockSentinel = await requestLock();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            if (wakeLockSentinel && typeof (wakeLockSentinel as { release: () => void }).release === 'function') {
                (wakeLockSentinel as { release: () => void }).release();
            }
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isSupported, requestLock]);

    return { isSupported, isLocked, error };
}
