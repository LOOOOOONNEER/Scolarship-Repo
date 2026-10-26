import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'sf-install-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable: the banner just returns next visit */
    }
  };

  if (deferred) {
    return (
      <div className="install-banner" role="region" aria-label="Install the app">
        <span>Install Scholarship Finder for deadline alerts on your phone.</span>
        <div className="row">
          <button
            type="button"
            className="button small"
            onClick={async () => {
              await deferred.prompt();
              setDeferred(null);
            }}
          >
            Install
          </button>
          <button type="button" className="link-button" onClick={dismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }

  if (isIos()) {
    return (
      <div className="install-banner" role="region" aria-label="Install the app">
        <span>
          On iPhone, alerts work only after you tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
        <button type="button" className="link-button" onClick={dismiss}>
          Got it
        </button>
      </div>
    );
  }

  return null;
}
