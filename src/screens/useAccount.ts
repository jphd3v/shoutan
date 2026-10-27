import { useEffect, useState } from 'react';
import type { Account } from '../net/api';
import { reporter, setReportContext } from '../report/install';
import { api } from '../net/client';

/** An account change remounts the game so caches and pending callbacks retain their original owner. */
export function useAccount() {
  const [account, setAccount] = useState<Account | null | undefined>(api ? undefined : null);
  useEffect(() => {
    const update = (next: Account | null) => {
      reporter.setOwner(next?.id ?? null);
      setReportContext(() => ({}));
      setAccount(next);
    };
    if (!api) {
      reporter.setOwner(null);
      return;
    }
    let active = true;
    let changed = false;
    const stop = api.watchAccount((next) => {
      changed = true;
      if (active) update(next);
    });
    void api.account().then(
      (next) => {
        if (active && !changed) update(next);
      },
      () => {
        if (active && !changed) update(null);
      },
    );
    return () => {
      active = false;
      stop();
    };
  }, []);
  return account;
}
