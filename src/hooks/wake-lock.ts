import { useCallback, useEffect, useRef, useState } from 'react';
import NoSleep from 'nosleep.js';

/**
 * Keeps mobile screens awake using the native wake lock API where available,
 * with a no-sleep fallback for browsers like iOS Safari.
 */
export function useWakeLock() {
    const [isLocked, setIsLocked] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const noSleepRef = useRef<NoSleep | null>(null);

    const enableWakeLock = useCallback(async () => {
        if (!noSleepRef.current) {
            noSleepRef.current = new NoSleep();
        }

        try {
            await noSleepRef.current.enable();
            setIsLocked(true);
            setError(null);
        } catch (err: unknown) {
            const wakeLockError = err as Error;
            setIsLocked(false);
            setError(wakeLockError.message);
        }
    }, []);

    const disableWakeLock = useCallback(() => {
        if (!noSleepRef.current) {
            return;
        }

        noSleepRef.current.disable();
        setIsLocked(false);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        let isUnmounted = false;

        const requestWakeLock = async () => {
            if (isUnmounted || document.visibilityState !== 'visible') {
                return;
            }

            await enableWakeLock();
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                void requestWakeLock();
            } else {
                disableWakeLock();
            }
        };

        const handlePageActivation = () => {
            if (document.visibilityState === 'visible' && !noSleepRef.current?.isEnabled) {
                void requestWakeLock();
            }
        };

        const handleUserInteraction = () => {
            if (!noSleepRef.current?.isEnabled) {
                void requestWakeLock();
            }
        };

        void requestWakeLock();

        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('focus', handlePageActivation);
        window.addEventListener('pageshow', handlePageActivation);
        document.addEventListener('click', handleUserInteraction, { passive: true });
        document.addEventListener('touchstart', handleUserInteraction, { passive: true });
        document.addEventListener('keydown', handleUserInteraction);

        const keepAliveInterval = window.setInterval(() => {
            if (document.visibilityState === 'visible' && !noSleepRef.current?.isEnabled) {
                void requestWakeLock();
            }
        }, 15000);

        return () => {
            isUnmounted = true;
            window.clearInterval(keepAliveInterval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('focus', handlePageActivation);
            window.removeEventListener('pageshow', handlePageActivation);
            document.removeEventListener('click', handleUserInteraction);
            document.removeEventListener('touchstart', handleUserInteraction);
            document.removeEventListener('keydown', handleUserInteraction);
            disableWakeLock();
        };
    }, [disableWakeLock, enableWakeLock]);

    return { isSupported: typeof window !== 'undefined', isLocked, error };
}
