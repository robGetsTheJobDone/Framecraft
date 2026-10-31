import './StartupScreen.css';

export function StartupScreen({error}: {error?: string}) {
  return <main className="framecraft-startup">
    <div className="framecraft-startup__content">
      <div className="framecraft-startup__wordmark">Frame<wbr /><span>craft<span aria-hidden="true">.</span></span></div>
      <div className="framecraft-startup__indicator" data-loading={!error} aria-hidden="true"><span /></div>
      <div role={error ? 'alert' : 'status'} aria-atomic="true">
        <h1>{error ? 'Your studio couldn’t load' : 'Loading your studio…'}</h1>
        <p className="framecraft-startup__support">{error ? 'We couldn’t prepare the starter assets. Reload to try again.' : 'Preparing starter assets for your workspace.'}</p>
        {error && <p className="framecraft-startup__error">{error}</p>}
      </div>
      {error && <button type="button" onClick={() => window.location.reload()}>Reload studio</button>}
    </div>
  </main>;
}
